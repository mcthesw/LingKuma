'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANKI_NAMESPACE,
  initializeAnkiRuntime,
} = require('../../../src/anki/runtime');

function createBrowserApi() {
  const listeners = [];
  return {
    listeners,
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
  };
}

test('runtime initializes once and accepts handlers added later', () => {
  const browserApi = createBrowserApi();
  const scope = {};
  const first = initializeAnkiRuntime({ browserApi, scope });
  const second = initializeAnkiRuntime({
    browserApi,
    scope,
    handlers: { ping: payload => ({ echo: payload.value }) },
  });

  assert.equal(first, second);
  assert.equal(browserApi.listeners.length, 1);

  let response;
  const keepChannel = browserApi.listeners[0](
    { namespace: ANKI_NAMESPACE, requestId: 'r1', type: 'ping', payload: { value: 7 } },
    {},
    value => { response = value; },
  );
  assert.equal(keepChannel, false);
  assert.deepEqual(response, { ok: true, requestId: 'r1', data: { echo: 7 } });
});

test('runtime ignores every foreign message without side effects', () => {
  const browserApi = createBrowserApi();
  initializeAnkiRuntime({ browserApi, scope: {} });

  let responded = false;
  const keepChannel = browserApi.listeners[0](
    { action: 'legacy-message' },
    {},
    () => { responded = true; },
  );

  assert.equal(keepChannel, false);
  assert.equal(responded, false);
});

test('runtime only keeps the channel open for asynchronous handlers', async () => {
  const browserApi = createBrowserApi();
  initializeAnkiRuntime({
    browserApi,
    scope: {},
    handlers: { later: async () => 'done' },
  });

  const response = new Promise(resolve => {
    const keepChannel = browserApi.listeners[0](
      { namespace: ANKI_NAMESPACE, requestId: 'r2', type: 'later', payload: {} },
      {},
      resolve,
    );
    assert.equal(keepChannel, true);
  });

  assert.deepEqual(await response, { ok: true, requestId: 'r2', data: 'done' });
});
