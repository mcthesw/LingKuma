'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeAnkiRuntime } = require('../../../src/anki/runtime');
const { createContentFacade } = require('../../../src/anki/content-adapter');

function createLoopbackBrowserApi() {
  const listeners = [];
  const runtime = {
    lastError: null,
    onMessage: {
      addListener(listener) {
        listeners.push(listener);
      },
    },
    sendMessage(message, callback) {
      let handled = false;
      for (const listener of listeners) {
        const result = listener(message, { id: 'test-extension' }, response => {
          handled = true;
          callback(response);
        });
        if (result === true) {
          handled = true;
          break;
        }
        if (handled) {
          break;
        }
      }
      if (!handled) {
        runtime.lastError = { message: 'No receiver' };
        callback(undefined);
        runtime.lastError = null;
      }
    },
  };
  return { runtime };
}

test('content facade reaches only the namespaced background handler', async () => {
  const browserApi = createLoopbackBrowserApi();
  initializeAnkiRuntime({
    browserApi,
    scope: {},
    handlers: {
      'capture.lookup': payload => ({ captureId: 'lk1_test', term: payload.term }),
    },
  });
  const facade = createContentFacade({
    browserApi,
    scope: { crypto: { randomUUID: () => 'request-1' } },
  });

  assert.deepEqual(
    await facade.captureLookup({ term: 'yield' }),
    { captureId: 'lk1_test', term: 'yield' },
  );
});
