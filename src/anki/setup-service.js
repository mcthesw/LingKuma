'use strict';

const { AnkiConnectClient, DEFAULT_ENDPOINT } = require('./anki-client');
const { ContractError } = require('./contracts');
const { MODEL_NAME, assertDeckExists, ensureNoteModel } = require('./note-model');

const SETTINGS_META_KEY = 'ankiSettingsV1';
const LANGUAGE_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const SETUP_KEYS = new Set([
  'endpoint',
  'apiKey',
  'deckName',
  'learningLanguage',
  'meaningLanguage',
  'autoCaptureEnabled',
  'attachAudio',
  'confirmSingleProfile',
]);
const PREFERENCE_KEYS = new Set(['autoCaptureEnabled', 'attachAudio']);

function validateLanguage(value, field) {
  if (typeof value !== 'string' || !LANGUAGE_PATTERN.test(value)) {
    throw new ContractError('INPUT_INVALID', `${field} is invalid.`);
  }
  return value.toLowerCase();
}

function validateBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new ContractError('INPUT_INVALID', `${field} must be a boolean.`);
  }
  return value;
}

function validatePayload(payload, allowedKeys = SETUP_KEYS) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some(key => !allowedKeys.has(key))) {
    throw new ContractError('INPUT_INVALID', 'Anki settings payload is invalid.');
  }
  return payload;
}

function publicSettings(settings) {
  if (!settings?.configured) {
    return Object.freeze({
      configured: false,
      endpoint: DEFAULT_ENDPOINT,
      hasApiKey: false,
      deckName: '',
      modelName: MODEL_NAME,
      learningLanguage: 'en',
      meaningLanguage: 'zh',
      autoCaptureEnabled: false,
      attachAudio: true,
      expectedProfile: null,
      profileDetectionSupported: null,
      profileWarning: null,
    });
  }
  return Object.freeze({
    configured: true,
    endpoint: settings.endpoint,
    hasApiKey: Boolean(settings.apiKey),
    deckName: settings.deckName,
    modelName: MODEL_NAME,
    learningLanguage: settings.learningLanguage,
    meaningLanguage: settings.meaningLanguage,
    autoCaptureEnabled: settings.autoCaptureEnabled,
    attachAudio: settings.attachAudio,
    expectedProfile: settings.expectedProfile || null,
    profileDetectionSupported: settings.profileDetectionSupported,
    profileWarning: settings.profileWarning || null,
  });
}

function isTrustedManagementSender(sender, browserApi) {
  if (!sender || sender.id !== browserApi?.runtime?.id || typeof sender.url !== 'string') {
    return false;
  }
  try {
    const base = new URL(browserApi.runtime.getURL('/'));
    const url = new URL(sender.url);
    return url.protocol === base.protocol && url.host === base.host
      && ['/src/options/options.html', '/src/anki/manager.html'].includes(url.pathname);
  } catch (_) {
    return false;
  }
}

function requireTrustedManagement(handler, browserApi) {
  return (payload, context) => {
    if (!isTrustedManagementSender(context?.sender, browserApi)) {
      throw new ContractError('FORBIDDEN', 'This operation is only available from a trusted extension page.');
    }
    return handler(payload, context);
  };
}

class SettingsBackedAnkiClient {
  constructor({ settingsService }) {
    this.settingsService = settingsService;
  }

  async #client() {
    return this.settingsService.createConfiguredClient();
  }

  async getProfileStatus(...args) { return (await this.#client()).getProfileStatus(...args); }
  async deckNames(...args) { return (await this.#client()).deckNames(...args); }
  async modelNames(...args) { return (await this.#client()).modelNames(...args); }
  async modelFieldNames(...args) { return (await this.#client()).modelFieldNames(...args); }
  async createModel(...args) { return (await this.#client()).createModel(...args); }
  async findNotesByCaptureId(...args) { return (await this.#client()).findNotesByCaptureId(...args); }
  async notesInfo(...args) { return (await this.#client()).notesInfo(...args); }
  async addNote(...args) { return (await this.#client()).addNote(...args); }
  async updateNoteFields(...args) { return (await this.#client()).updateNoteFields(...args); }
  async storeMediaFile(...args) { return (await this.#client()).storeMediaFile(...args); }
  async guiBrowseNote(...args) { return (await this.#client()).guiBrowseNote(...args); }
}

class AnkiSettingsService {
  constructor({ repository, clientFactory = options => new AnkiConnectClient(options) } = {}) {
    if (!repository || typeof clientFactory !== 'function') {
      throw new TypeError('repository and clientFactory are required.');
    }
    this.repository = repository;
    this.clientFactory = clientFactory;
  }

  async getPrivate() {
    return await this.repository.getMeta(SETTINGS_META_KEY);
  }

  async getPublic() {
    return publicSettings(await this.getPrivate());
  }

  async createConfiguredClient() {
    const settings = await this.getPrivate();
    if (!settings?.configured) {
      throw new ContractError('DECK_MISSING', 'Complete Anki setup before writing notes.');
    }
    return this.clientFactory({ endpoint: settings.endpoint, key: settings.apiKey || '' });
  }

  async testConnection(payload = {}) {
    validatePayload(payload);
    const previous = await this.getPrivate();
    const endpoint = payload.endpoint ?? previous?.endpoint ?? DEFAULT_ENDPOINT;
    const apiKey = payload.apiKey === undefined ? previous?.apiKey || '' : payload.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length > 4096) {
      throw new ContractError('INPUT_INVALID', 'AnkiConnect API key is invalid.');
    }
    const client = this.clientFactory({ endpoint, key: apiKey });
    const [version, deckNames, profile] = await Promise.all([
      client.version(),
      client.deckNames(),
      client.getProfileStatus(null),
    ]);
    if (!Number.isInteger(version) || version < 6 || !Array.isArray(deckNames)
        || deckNames.some(name => typeof name !== 'string')) {
      throw new ContractError('API_UNSUPPORTED', 'AnkiConnect does not provide the required protocol capabilities.');
    }
    return Object.freeze({
      version,
      deckNames: [...deckNames].sort((left, right) => left.localeCompare(right)),
      activeProfile: profile.activeProfile,
      profileDetectionSupported: profile.supported,
      profileWarning: profile.warning || null,
    });
  }

  async ensureModel(payload = {}) {
    validatePayload(payload);
    const previous = await this.getPrivate();
    const endpoint = payload.endpoint ?? previous?.endpoint ?? DEFAULT_ENDPOINT;
    const apiKey = payload.apiKey === undefined ? previous?.apiKey || '' : payload.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length > 4096) {
      throw new ContractError('INPUT_INVALID', 'AnkiConnect API key is invalid.');
    }
    return ensureNoteModel(this.clientFactory({ endpoint, key: apiKey }));
  }

  async save(payload = {}) {
    validatePayload(payload);
    const previous = await this.getPrivate();
    const keys = Object.keys(payload);
    const preferencesOnly = previous?.configured && keys.length > 0
      && keys.every(key => PREFERENCE_KEYS.has(key));
    if (preferencesOnly) {
      const settings = {
        ...previous,
        ...(payload.autoCaptureEnabled === undefined ? {} : {
          autoCaptureEnabled: validateBoolean(payload.autoCaptureEnabled, 'autoCaptureEnabled'),
        }),
        ...(payload.attachAudio === undefined ? {} : {
          attachAudio: validateBoolean(payload.attachAudio, 'attachAudio'),
        }),
      };
      await this.repository.setMeta(SETTINGS_META_KEY, settings);
      return publicSettings(settings);
    }

    const endpoint = payload.endpoint ?? previous?.endpoint ?? DEFAULT_ENDPOINT;
    const apiKey = payload.apiKey === undefined ? previous?.apiKey || '' : payload.apiKey;
    const deckName = payload.deckName ?? previous?.deckName;
    const learningLanguage = validateLanguage(payload.learningLanguage ?? previous?.learningLanguage ?? 'en', 'learningLanguage');
    const meaningLanguage = validateLanguage(payload.meaningLanguage ?? previous?.meaningLanguage ?? 'zh', 'meaningLanguage');
    const autoCaptureEnabled = validateBoolean(payload.autoCaptureEnabled ?? true, 'autoCaptureEnabled');
    const attachAudio = validateBoolean(payload.attachAudio ?? true, 'attachAudio');
    if (typeof apiKey !== 'string' || apiKey.length > 4096 || typeof deckName !== 'string' || !deckName.trim()) {
      throw new ContractError('INPUT_INVALID', 'Anki connection or deck settings are incomplete.');
    }

    const readiness = await this.testConnection({ endpoint, apiKey });
    const client = this.clientFactory({ endpoint, key: apiKey });
    await assertDeckExists(client, deckName);
    if (!readiness.profileDetectionSupported && payload.confirmSingleProfile !== true) {
      throw new ContractError(
        'API_UNSUPPORTED',
        'This AnkiConnect version cannot detect profile changes. Confirm single-profile use to continue.',
      );
    }
    await ensureNoteModel(client);

    const settings = {
      configured: true,
      endpoint: client.endpoint || endpoint,
      apiKey,
      deckName,
      modelName: MODEL_NAME,
      learningLanguage,
      meaningLanguage,
      autoCaptureEnabled,
      attachAudio,
      expectedProfile: readiness.profileDetectionSupported ? readiness.activeProfile : null,
      profileDetectionSupported: readiness.profileDetectionSupported,
      profileWarning: readiness.profileWarning,
    };
    await this.repository.setMeta(SETTINGS_META_KEY, settings);
    await this.repository.bindUnconfiguredCaptures({
      deckName,
      modelName: MODEL_NAME,
      expectedProfile: settings.expectedProfile,
    });
    return publicSettings(settings);
  }

  async getCaptureDefaults() {
    const settings = await this.getPrivate();
    if (!settings?.configured) {
      return {};
    }
    return {
      destination: {
        deckName: settings.deckName,
        modelName: MODEL_NAME,
        expectedProfile: settings.expectedProfile,
      },
      mediaState: settings.attachAudio ? 'pending' : 'disabled',
    };
  }

  async getLookupPolicy() {
    const settings = await this.getPrivate();
    if (!settings?.configured) {
      return { enabled: true, learningLanguage: null, defaults: {} };
    }
    return {
      enabled: settings.autoCaptureEnabled,
      learningLanguage: settings.learningLanguage,
      defaults: await this.getCaptureDefaults(),
    };
  }

  async getMeaningLanguage() {
    return (await this.getPrivate())?.meaningLanguage || 'zh';
  }
}

module.exports = {
  AnkiSettingsService,
  PREFERENCE_KEYS,
  SETTINGS_META_KEY,
  SETUP_KEYS,
  SettingsBackedAnkiClient,
  isTrustedManagementSender,
  publicSettings,
  requireTrustedManagement,
  validatePayload,
};
