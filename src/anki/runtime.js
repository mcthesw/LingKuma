'use strict';

const ANKI_NAMESPACE = 'lingkuma.anki.v1';
const RUNTIME_STATE_KEY = '__lingkumaAnkiRuntimeV1';

function errorResponse(requestId, code, message, retryable = false) {
  return {
    ok: false,
    requestId: typeof requestId === 'string' ? requestId : null,
    error: { code, message, retryable },
  };
}

function normalizeHandlerError(requestId, error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return errorResponse(
      requestId,
      error.code,
      typeof error.message === 'string' ? error.message : error.code,
      error.retryable === true,
    );
  }

  return errorResponse(requestId, 'INTERNAL_ERROR', 'Anki integration request failed.');
}

function createMessageRouter(handlers) {
  return function routeAnkiMessage(message, sender, sendResponse) {
    if (!message || message.namespace !== ANKI_NAMESPACE) {
      return false;
    }

    const requestId = message.requestId;
    if (typeof requestId !== 'string' || requestId.length === 0 || typeof message.type !== 'string') {
      sendResponse(errorResponse(requestId, 'INPUT_INVALID', 'Invalid Anki integration message.'));
      return false;
    }

    const handler = handlers.get(message.type);
    if (!handler) {
      sendResponse(errorResponse(requestId, 'UNSUPPORTED_MESSAGE', 'Unsupported Anki integration message.'));
      return false;
    }

    try {
      const result = handler(message.payload, { message, sender });
      if (result && typeof result.then === 'function') {
        result.then(
          data => sendResponse({ ok: true, requestId, data }),
          error => sendResponse(normalizeHandlerError(requestId, error)),
        );
        return true;
      }

      sendResponse({ ok: true, requestId, data: result });
      return false;
    } catch (error) {
      sendResponse(normalizeHandlerError(requestId, error));
      return false;
    }
  };
}

function initializeAnkiRuntime({ browserApi, handlers = {}, scope = globalThis } = {}) {
  if (!browserApi?.runtime?.onMessage?.addListener) {
    throw new Error('A browser runtime message API is required.');
  }

  const existing = scope[RUNTIME_STATE_KEY];
  if (existing) {
    existing.registerHandlers(handlers);
    return existing;
  }

  const handlerMap = new Map();
  const state = {
    namespace: ANKI_NAMESPACE,
    registerHandlers(nextHandlers) {
      for (const [type, handler] of Object.entries(nextHandlers || {})) {
        if (typeof handler !== 'function') {
          throw new TypeError(`Handler for ${type} must be a function.`);
        }
        handlerMap.set(type, handler);
      }
    },
  };

  state.registerHandlers(handlers);
  const listener = createMessageRouter(handlerMap);
  browserApi.runtime.onMessage.addListener(listener);
  Object.defineProperty(state, 'listener', { value: listener });
  Object.defineProperty(scope, RUNTIME_STATE_KEY, {
    value: state,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return state;
}

module.exports = {
  ANKI_NAMESPACE,
  RUNTIME_STATE_KEY,
  createMessageRouter,
  initializeAnkiRuntime,
};
