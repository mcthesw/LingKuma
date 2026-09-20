'use strict';

const { ANKI_NAMESPACE } = require('./runtime');

const PUBLIC_FACADE_KEY = 'LingKumaAnki';
const ALLOWED_REQUEST_TYPES = Object.freeze({
  captureLookup: 'capture.lookup',
  getCapture: 'capture.get',
  lookupState: 'capture.lookupState',
});

function createRequestId(scope) {
  if (scope.crypto?.randomUUID) {
    return scope.crypto.randomUUID();
  }
  return `lk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sendRuntimeMessage(browserApi, message) {
  return new Promise((resolve, reject) => {
    browserApi.runtime.sendMessage(message, response => {
      const runtimeError = browserApi.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || 'Extension message failed.'));
        return;
      }
      resolve(response);
    });
  });
}

function createContentFacade({ browserApi, scope = globalThis } = {}) {
  if (!browserApi?.runtime?.sendMessage) {
    throw new Error('A browser runtime messaging API is required.');
  }

  async function request(type, payload) {
    const requestId = createRequestId(scope);
    const response = await sendRuntimeMessage(browserApi, {
      namespace: ANKI_NAMESPACE,
      requestId,
      type,
      payload,
    });

    if (!response || response.requestId !== requestId || typeof response.ok !== 'boolean') {
      throw new Error('Invalid Anki integration response.');
    }
    if (!response.ok) {
      const error = new Error(response.error?.message || 'Anki integration request failed.');
      error.code = response.error?.code || 'INTERNAL_ERROR';
      error.retryable = response.error?.retryable === true;
      throw error;
    }
    return response.data;
  }

  return Object.freeze({
    namespace: ANKI_NAMESPACE,
    version: 1,
    captureLookup(payload) {
      return request(ALLOWED_REQUEST_TYPES.captureLookup, payload);
    },
    getCapture(payload) {
      return request(ALLOWED_REQUEST_TYPES.getCapture, payload);
    },
    lookupState(payload) {
      return request(ALLOWED_REQUEST_TYPES.lookupState, payload);
    },
  });
}

function installContentFacade({ browserApi, scope = globalThis } = {}) {
  if (Object.prototype.hasOwnProperty.call(scope, PUBLIC_FACADE_KEY)) {
    return scope[PUBLIC_FACADE_KEY];
  }

  const facade = createContentFacade({ browserApi, scope });
  Object.defineProperty(scope, PUBLIC_FACADE_KEY, {
    value: facade,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return facade;
}

module.exports = {
  ALLOWED_REQUEST_TYPES,
  PUBLIC_FACADE_KEY,
  createContentFacade,
  installContentFacade,
};
