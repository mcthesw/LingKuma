'use strict';

const { ContractError } = require('./contracts');
const { isCaptureId } = require('./identity');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765/';
const PROTOCOL_VERSION = 6;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const READ_ACTIONS = new Set([
  'version',
  'apiReflect',
  'deckNames',
  'modelNames',
  'modelFieldNames',
  'findNotes',
  'notesInfo',
  'getActiveProfile',
]);
const WRITE_ACTIONS = new Set([
  'createModel',
  'addNote',
  'updateNoteFields',
  'storeMediaFile',
  'guiBrowse',
]);
const ALLOWED_ACTIONS = new Set([...READ_ACTIONS, ...WRITE_ACTIONS]);

function validateEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value || DEFAULT_ENDPOINT);
  } catch (_) {
    throw new ContractError('INPUT_INVALID', 'AnkiConnect endpoint is invalid.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)
      || !LOOPBACK_HOSTS.has(endpoint.hostname)
      || endpoint.username || endpoint.password
      || (endpoint.pathname && endpoint.pathname !== '/')
      || endpoint.search || endpoint.hash) {
    throw new ContractError('INPUT_INVALID', 'AnkiConnect endpoint must be an exact loopback HTTP(S) origin.');
  }
  endpoint.pathname = '/';
  return endpoint.href;
}

function assertNoteId(noteId) {
  if (!Number.isSafeInteger(noteId) || noteId <= 0) {
    throw new ContractError('INPUT_INVALID', 'Invalid Anki note id.');
  }
  return noteId;
}

function assertFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
      || Object.values(fields).some(value => typeof value !== 'string')) {
    throw new ContractError('INPUT_INVALID', 'Anki fields must be a string map.');
  }
  return fields;
}

function mapTransportError(error, timedOut) {
  if (error instanceof ContractError) {
    return error;
  }
  if (timedOut || error?.name === 'AbortError') {
    return new ContractError('TIMEOUT', 'AnkiConnect request timed out.', { retryable: true });
  }
  return new ContractError('ANKI_UNREACHABLE', 'AnkiConnect is unavailable.', {
    retryable: true,
    details: { name: error?.name || 'Error' },
  });
}

function isUnsupportedAction(error) {
  if (!(error instanceof ContractError) || !['ANKI_API_ERROR', 'API_UNSUPPORTED'].includes(error.code)) {
    return false;
  }
  return /unsupported|not supported|unknown action|invalid action|not found/i.test(
    error.details?.remoteMessage || error.message,
  );
}

class AnkiConnectClient {
  constructor({
    endpoint = DEFAULT_ENDPOINT,
    key = '',
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
    readRetries = 1,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new ContractError('INPUT_INVALID', 'A fetch implementation is required.');
    }
    this.endpoint = validateEndpoint(endpoint);
    this.key = typeof key === 'string' ? key : '';
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.readRetries = Math.max(0, Math.min(2, readRetries));
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
  }

  async invoke(action, params = {}, options = {}) {
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new ContractError('API_UNSUPPORTED', `AnkiConnect action ${action} is not allowed.`);
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new ContractError('INPUT_INVALID', 'AnkiConnect params must be an object.');
    }

    const attempts = READ_ACTIONS.has(action)
      ? 1 + (options.readRetries ?? this.readRetries)
      : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.#request(action, params, options);
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt + 1 >= attempts) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  async #request(action, params, options) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    let timedOut = false;
    const timeout = this.setTimeoutImpl(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });

    const payload = { action, version: PROTOCOL_VERSION, params };
    if (this.key) {
      payload.key = this.key;
    }

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.redirected || response.type === 'opaqueredirect'
          || (response.status >= 300 && response.status < 400)) {
        throw new ContractError('INPUT_INVALID', 'AnkiConnect redirects are not allowed.');
      }
      if (!response.ok) {
        throw new ContractError('ANKI_UNREACHABLE', `AnkiConnect returned HTTP ${response.status}.`, {
          retryable: response.status >= 500,
          details: { status: response.status },
        });
      }

      let body;
      try {
        body = await response.json();
      } catch (_) {
        throw new ContractError('API_UNSUPPORTED', 'AnkiConnect returned invalid JSON.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)
          || !Object.prototype.hasOwnProperty.call(body, 'result')
          || !Object.prototype.hasOwnProperty.call(body, 'error')) {
        throw new ContractError('API_UNSUPPORTED', 'AnkiConnect response shape is invalid.');
      }
      if (body.error !== null) {
        throw new ContractError('ANKI_API_ERROR', 'AnkiConnect rejected the request.', {
          retryable: false,
          details: { action, remoteMessage: String(body.error) },
        });
      }
      return body.result;
    } catch (error) {
      throw mapTransportError(error, timedOut);
    } finally {
      this.clearTimeoutImpl(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  version(options) {
    return this.invoke('version', {}, options);
  }

  deckNames(options) {
    return this.invoke('deckNames', {}, options);
  }

  modelNames(options) {
    return this.invoke('modelNames', {}, options);
  }

  modelFieldNames(modelName, options) {
    if (typeof modelName !== 'string' || !modelName.trim()) {
      throw new ContractError('INPUT_INVALID', 'modelName is required.');
    }
    return this.invoke('modelFieldNames', { modelName }, options);
  }

  createModel(model, options) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      throw new ContractError('INPUT_INVALID', 'Model definition is required.');
    }
    return this.invoke('createModel', model, options);
  }

  findNotesByCaptureId(captureId, options) {
    if (!isCaptureId(captureId)) {
      throw new ContractError('INPUT_INVALID', 'Invalid capture id.');
    }
    return this.invoke('findNotes', { query: `CaptureId:${captureId}` }, options);
  }

  notesInfo(noteIds, options) {
    if (!Array.isArray(noteIds)) {
      throw new ContractError('INPUT_INVALID', 'noteIds must be an array.');
    }
    return this.invoke('notesInfo', { notes: noteIds.map(assertNoteId) }, options);
  }

  addNote(note, options) {
    if (!note || typeof note !== 'object' || Array.isArray(note)) {
      throw new ContractError('INPUT_INVALID', 'Anki note is required.');
    }
    return this.invoke('addNote', { note }, options);
  }

  updateNoteFields(noteId, fields, options) {
    return this.invoke('updateNoteFields', {
      note: { id: assertNoteId(noteId), fields: assertFields(fields) },
    }, options);
  }

  storeMediaFile(filename, data, options) {
    if (!/^[A-Za-z0-9_.-]+$/.test(filename) || typeof data !== 'string' || !data) {
      throw new ContractError('INPUT_INVALID', 'Media filename and base64 data are invalid.');
    }
    return this.invoke('storeMediaFile', { filename, data }, options);
  }

  guiBrowseNote(noteId, options) {
    return this.invoke('guiBrowse', { query: `nid:${assertNoteId(noteId)}` }, options);
  }

  async getProfileStatus(expectedProfile, options) {
    try {
      const activeProfile = await this.invoke('getActiveProfile', {}, options);
      if (typeof activeProfile !== 'string' || !activeProfile) {
        throw new ContractError('API_UNSUPPORTED', 'getActiveProfile returned an invalid result.');
      }
      if (expectedProfile && activeProfile !== expectedProfile) {
        throw new ContractError('PROFILE_MISMATCH', 'The active Anki profile differs from setup.', {
          details: { expectedProfile, activeProfile },
        });
      }
      return { supported: true, activeProfile, matches: expectedProfile ? true : null };
    } catch (error) {
      if (isUnsupportedAction(error)) {
        return {
          supported: false,
          activeProfile: null,
          matches: null,
          warning: 'This AnkiConnect version cannot detect profile changes.',
        };
      }
      throw error;
    }
  }
}

module.exports = {
  ALLOWED_ACTIONS,
  AnkiConnectClient,
  DEFAULT_ENDPOINT,
  PROTOCOL_VERSION,
  READ_ACTIONS,
  WRITE_ACTIONS,
  assertNoteId,
  validateEndpoint,
};
