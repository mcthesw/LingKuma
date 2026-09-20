'use strict';

const { AnkiConnectClient } = require('./anki-client');
const { CaptureService } = require('./capture-service');
const { ContractError } = require('./contracts');
const { EnrichmentCoordinator } = require('./enrichment');
const { createProviderAdapter } = require('./provider-adapter');
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
    });
    const syncService = new SyncService({ repository, ankiClient });
    const scheduler = new JobScheduler({
      repository,
      enrichmentCoordinator,
      syncService,
      alarmClock: new BrowserAlarmClock(browserApi),
    });
    const captureService = new CaptureService({
      repository,
      getCaptureDefaults: () => settingsService.getCaptureDefaults(),
      scheduleDrain: reason => scheduler.scheduleDrain(reason),
    });
    return {
      captureService,
      repository,
      scheduler,
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
    'capture.lookup': content(async payload => (await services).captureService.lookup(payload)),
    'capture.get': content(async payload => (await services).captureService.get(captureIdPayload(payload))),
    'capture.lookupState': content(async payload => (await services).captureService.get(captureIdPayload(payload))),
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
  initializeAnkiBackground,
  requireContentSender,
};
