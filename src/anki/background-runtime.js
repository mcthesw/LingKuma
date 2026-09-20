'use strict';

const { AnkiConnectClient } = require('./anki-client');
const { AssociationStore } = require('./association-store');
const { createSupertoneAudioProvider } = require('./audio-provider');
const { CaptureService } = require('./capture-service');
const { ContractError } = require('./contracts');
const { EnrichmentCoordinator } = require('./enrichment');
const { MediaService } = require('./media-service');
const { ManagementService } = require('./management-service');
const { ManagementStore } = require('./management-store');
const { MediaStore } = require('./media-store');
const { createProviderAdapter } = require('./provider-adapter');
const { ReconciliationService } = require('./reconciliation-service');
const { openAnkiRepository } = require('./repository');
const {
  ANKI_ALARM_NAME,
  BrowserAlarmClock,
  JobScheduler,
  installSchedulerRuntime,
} = require('./scheduler');
const {
  AnkiSettingsService,
  PREFERENCE_KEYS,
  SettingsBackedAnkiClient,
  requireTrustedManagement,
} = require('./setup-service');
const { SyncService } = require('./sync-service');

function captureIdPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).length !== 1 || typeof payload.captureId !== 'string') {
    throw new ContractError('INPUT_INVALID', 'Capture request is invalid.');
  }
  return payload.captureId;
}

function requireContentSender(handler, browserApi) {
  return (payload, context) => {
    const sender = context?.sender;
    if (!sender?.tab || sender.id !== browserApi?.runtime?.id) {
      throw new ContractError('FORBIDDEN', 'This operation is only available to extension content scripts.');
    }
    return handler(payload, context);
  };
}

function createLazyScheduler(servicePromise) {
  return {
    alarmName: ANKI_ALARM_NAME,
    async start() { return (await servicePromise).scheduler.start(); },
    async scheduleDrain(reason) { return (await servicePromise).scheduler.scheduleDrain(reason); },
    async ensureWakeup() { return (await servicePromise).scheduler.ensureWakeup(); },
    async settingsRepaired() { return (await servicePromise).scheduler.settingsRepaired(); },
  };
}
function createCaptureNotifier(browserApi) {
  const captures = new Map();
  const slots = new Map();

  function removeSlot(slot) {
    const previous = slots.get(slot);
    if (!previous) return;
    slots.delete(slot);
    const subscribers = captures.get(previous.captureId);
    subscribers?.delete(slot);
    if (subscribers?.size === 0) captures.delete(previous.captureId);
  }

  function track(captureId, sender) {
    if (typeof captureId !== 'string' || !Number.isInteger(sender?.tab?.id)) return;
    const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
    const slot = `${sender.tab.id}:${frameId}`;
    removeSlot(slot);
    const target = { captureId, tabId: sender.tab.id, frameId };
    slots.set(slot, target);
    if (!captures.has(captureId)) captures.set(captureId, new Map());
    captures.get(captureId).set(slot, target);
  }

  function notify(capture) {
    const subscribers = captures.get(capture?.captureId);
    if (!subscribers) return;
    const message = {
      namespace: 'lingkuma.anki.v1',
      type: 'capture.changed',
      payload: capture,
    };
    for (const [slot, target] of [...subscribers]) {
      try {
        const delivery = browserApi.tabs.sendMessage(
          target.tabId,
          message,
          { frameId: target.frameId },
        );
        if (delivery?.catch) delivery.catch(() => removeSlot(slot));
      } catch (_) {
        removeSlot(slot);
      }
    }
  }

  return Object.freeze({ notify, track });
}


function initializeAnkiBackground({
  browserApi,
  runtime,
  providerRequest,
  indexedDB = globalThis.indexedDB,
  fetchImpl = globalThis.fetch,
  scope = globalThis,
} = {}) {
  if (!browserApi || !runtime?.registerHandlers || typeof providerRequest !== 'function') {
    throw new TypeError('Browser runtime and provider request transport are required.');
  }

  const captureNotifier = createCaptureNotifier(browserApi);
  const services = (async () => {
    const repository = await openAnkiRepository({ indexedDB });
    const settingsService = new AnkiSettingsService({
      repository,
      clientFactory: options => new AnkiConnectClient({ ...options, fetchImpl }),
    });
    const ankiClient = new SettingsBackedAnkiClient({ settingsService });
    const provider = createProviderAdapter({ request: providerRequest });
    const enrichmentCoordinator = new EnrichmentCoordinator({
      repository,
      provider,
      getMeaningLanguage: () => settingsService.getMeaningLanguage(),
      notifyCaptureChanged: captureNotifier.notify,
    });
    const syncService = new SyncService({
      repository,
      ankiClient,
      notifyCaptureChanged: captureNotifier.notify,
    });
    const mediaService = new MediaService({
      repository,
      mediaStore: new MediaStore(repository),
      audioProvider: createSupertoneAudioProvider({
        storage: browserApi.storage?.local || { get: (_keys, callback) => callback({}) },
        fetchImpl,
      }),
      ankiClient,
      notifyCaptureChanged: captureNotifier.notify,
    });
    const reconciliationService = new ReconciliationService({
      repository,
      associationStore: new AssociationStore(repository),
      ankiClient,
      notifyCaptureChanged: captureNotifier.notify,
    });
    const scheduler = new JobScheduler({
      repository,
      enrichmentCoordinator,
      syncService,
      mediaService,
      reconciliationService,
      alarmClock: new BrowserAlarmClock(browserApi),
    });
    const captureService = new CaptureService({
      repository,
      getLookupPolicy: () => settingsService.getLookupPolicy(),
      scheduleDrain: reason => scheduler.scheduleDrain(reason),
      notifyCaptureChanged: captureNotifier.notify,
    });
    const managementService = new ManagementService({
      repository,
      managementStore: new ManagementStore(repository),
      captureService,
      syncService,
      reconciliationService,
      ankiClient,
      scheduleDrain: reason => scheduler.scheduleDrain(reason),
    });
    return {
      captureService,
      repository,
      scheduler,
      managementService,
      settingsService,
    };
  })();

  const schedulerRuntime = installSchedulerRuntime({
    browserApi,
    scheduler: createLazyScheduler(services),
    scope,
  });
  const trusted = handler => requireTrustedManagement(handler, browserApi);
  const content = handler => requireContentSender(handler, browserApi);

  runtime.registerHandlers({
    'capture.lookup': content(async (payload, context) => {
      const result = await (await services).captureService.lookup(payload);
      if (result.captureId) captureNotifier.track(result.captureId, context.sender);
      return result;
    }),
    'capture.get': content(async payload => (await services).captureService.get(captureIdPayload(payload))),
    'capture.lookupState': content(async (payload, context) => {
      const captureId = captureIdPayload(payload);
      const result = await (await services).captureService.get(captureId);
      if (result) captureNotifier.track(captureId, context.sender);
      return result;
    }),
    'capture.list': trusted(async payload => (await services).managementService.list(payload || {})),
    'capture.inspect': trusted(async payload => (await services).managementService.inspect(payload || {})),
    'capture.edit': trusted(async payload => (await services).managementService.edit(payload || {})),
    'capture.regenerate': trusted(async payload => (await services).managementService.regenerate(payload || {})),
    'capture.retry': trusted(async payload => (await services).managementService.retry(payload || {})),
    'capture.exclude': trusted(async payload => (await services).managementService.exclude(payload || {})),
    'capture.resume': trusted(async payload => (await services).managementService.resume(payload || {})),
    'capture.resolve': trusted(async payload => (await services).managementService.resolve(payload || {})),
    'capture.openInAnki': trusted(async payload => (await services).managementService.openInAnki(payload || {})),
    'settings.getPublic': trusted(async () => {
      const state = await services;
      void schedulerRuntime.onManagementOpened().catch(() => {});
      return state.settingsService.getPublic();
    }),
    'connection.test': trusted(async payload => (await services).settingsService.testConnection(payload || {})),
    'model.ensure': trusted(async payload => (await services).settingsService.ensureModel(payload || {})),
    'settings.save': trusted(async payload => {
      const state = await services;
      const result = await state.settingsService.save(payload || {});
      const keys = Object.keys(payload || {});
      if (keys.some(key => !PREFERENCE_KEYS.has(key))) {
        await schedulerRuntime.onSettingsRepaired();
      }
      return result;
    }),
  });

  return Object.freeze({ schedulerRuntime, services });
}

module.exports = {
  captureIdPayload,
  createLazyScheduler,
  createCaptureNotifier,
  initializeAnkiBackground,
  requireContentSender,
};
