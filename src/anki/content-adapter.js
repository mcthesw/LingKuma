'use strict';

const { ANKI_NAMESPACE } = require('./runtime');
const { freezeReaderOriginSnapshot } = require('./reader-adapters');

const PUBLIC_FACADE_KEY = 'LingKumaAnki';
const CAPTURE_CHANGED_TYPE = 'capture.changed';
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

function freezeWordOriginSnapshot({
  targetRange,
  contextRange,
  language,
  source,
} = {}) {
  if (!targetRange?.toString || !contextRange?.toString || !contextRange?.cloneRange) {
    throw new TypeError('Word and sentence ranges are required.');
  }
  const term = targetRange.toString();
  const contextText = contextRange.toString();
  const prefixRange = contextRange.cloneRange();
  prefixRange.setEnd(targetRange.startContainer, targetRange.startOffset);
  const targetStart = prefixRange.toString().length;
  const targetEnd = targetStart + term.length;
  if (!term || contextText.slice(targetStart, targetEnd) !== term) {
    const error = new Error('The selected word is outside its sentence context.');
    error.code = 'RANGE_MISMATCH';
    throw error;
  }
  return Object.freeze({
    language,
    term,
    contextText,
    targetStart,
    targetEnd,
    contextQuality: 'sentence',
    fallbackSourceKey: '',
    source: Object.freeze({ ...source }),
  });
}

function sensitiveElement(node) {
  let element = node?.nodeType === 1 ? node : node?.parentElement;
  while (element) {
    if (typeof element.matches === 'function') {
      if (element.matches('input, textarea, select')) return true;
      if (element.matches('[contenteditable]')
          && String(element.getAttribute('contenteditable')).toLowerCase() !== 'false') return true;
    }
    element = element.parentElement || element.getRootNode?.().host || null;
  }
  return false;
}

function isSensitiveSelectionTarget({ selection, target } = {}) {
  if (sensitiveElement(target) || sensitiveElement(selection?.anchorNode)
      || sensitiveElement(selection?.focusNode)) return true;
  if (selection?.rangeCount > 0) {
    try {
      return sensitiveElement(selection.getRangeAt(0).commonAncestorContainer);
    } catch (_) {
      return true;
    }
  }
  return false;
}

function disposeLookupController(target) {
  target?._ankiLookupController?.dispose();
  if (target?._ankiLookupController) delete target._ankiLookupController;
}

function captureStatusText(capture, { paused = false } = {}) {
  if (paused) return 'Anki 自动摘录已暂停';
  if (!capture) return '正在保存摘录…';
  const messages = {
    waiting_content: '本地已保存，正在生成释义…',
    waiting_setup: '本地已保存，待配置 Anki',
    waiting_anki: '本地已保存，等待写入 Anki…',
    synced: '已写入 Anki',
    content_failed: '本地已保存，释义暂不可用',
    blocked: '本地已保存，Anki 写入已暂停',
    conflict: '本地已保存，Anki 内容有变更',
    remote_missing: '本地已保存，Anki 笔记不存在',
    excluded: '摘录已存在，已停止管理',
  };
  return messages[capture.status] || '本地已保存';
}

function createWordLookupController({ facade, originSnapshot, onUpdate = () => {}, scope = globalThis } = {}) {
  if (!facade?.captureLookup || !facade?.lookupState || !facade?.onCaptureChanged) {
    throw new TypeError('A content facade is required.');
  }
  const lookupSessionId = createRequestId(scope);
  let active = true;
  let captureId = null;

  const emit = update => {
    if (!active) return;
    try {
      onUpdate(Object.freeze({ lookupSessionId, captureId, ...update }));
    } catch (_) {
      // Rendering errors must not interrupt persistence.
    }
  };
  const applyCapture = (capture, options = {}) => {
    if (!active || !capture || capture.captureId !== captureId) return;
    emit({
      phase: capture.status === 'synced' ? 'synced' : 'persisted',
      text: captureStatusText(capture, options),
      capture,
      paused: options.paused === true,
    });
  };
  const unsubscribe = facade.onCaptureChanged(capture => applyCapture(capture));
  emit({ phase: 'saving', text: captureStatusText(null), capture: null, paused: false });

  const ready = (async () => {
    let result;
    try {
      result = await facade.captureLookup({ lookupSessionId, originSnapshot });
    } catch (error) {
      emit({ phase: 'error', text: '摘录未能保存', capture: null, paused: false, error });
      throw error;
    }
    if (!active || result.lookupSessionId !== lookupSessionId) return result;
    captureId = result.captureId;
    if (result.paused && !result.capture) {
      emit({ phase: 'paused', text: captureStatusText(null, { paused: true }), capture: null, paused: true });
      return result;
    }
    applyCapture(result.capture, { paused: result.paused });
    if (captureId) {
      try {
        const recovered = await facade.lookupState({ captureId });
        applyCapture(recovered, { paused: result.paused });
      } catch (_) {
        // The committed ACK remains authoritative if a recovery read races navigation.
      }
    }
    return result;
  })();

  return Object.freeze({
    lookupSessionId,
    get captureId() { return captureId; },
    ready,
    dispose() {
      if (!active) return;
      active = false;
      unsubscribe();
    },
  });
}

function createContentFacade({ browserApi, scope = globalThis } = {}) {
  if (!browserApi?.runtime?.sendMessage) {
    throw new Error('A browser runtime messaging API is required.');
  }
  const changeListeners = new Set();
  if (browserApi.runtime.onMessage?.addListener) {
    browserApi.runtime.onMessage.addListener(message => {
      if (!message || message.namespace !== ANKI_NAMESPACE || message.type !== CAPTURE_CHANGED_TYPE) {
        return false;
      }
      const capture = message.payload;
      if (!capture || typeof capture.captureId !== 'string') return false;
      for (const listener of [...changeListeners]) {
        try {
          listener(capture);
        } catch (_) {
          // One tooltip renderer must not block other subscribers.
        }
      }
      return false;
    });
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

  const facade = {
    namespace: ANKI_NAMESPACE,
    captureLookup(payload) {
      return request(ALLOWED_REQUEST_TYPES.captureLookup, payload);
    },
    getCapture(payload) {
      return request(ALLOWED_REQUEST_TYPES.getCapture, payload);
    },
    lookupState(payload) {
      return request(ALLOWED_REQUEST_TYPES.lookupState, payload);
    },
    onCaptureChanged(listener) {
      if (typeof listener !== 'function') throw new TypeError('Capture listener must be a function.');
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    disposeLookupController,
    isSensitiveSelectionTarget,
    freezeWordOriginSnapshot,
    freezeReaderOriginSnapshot(options) {
      return freezeReaderOriginSnapshot({
        document: scope.document,
        location: scope.location,
        ...options,
      });
    },
    startWordLookup(options) {
      return createWordLookupController({ facade, scope, ...options });
    },
  };
  return Object.freeze(facade);
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
  CAPTURE_CHANGED_TYPE,
  PUBLIC_FACADE_KEY,
  captureStatusText,
  createContentFacade,
  createWordLookupController,
  disposeLookupController,
  freezeWordOriginSnapshot,
  isSensitiveSelectionTarget,
  freezeReaderOriginSnapshot,
  installContentFacade,
};
