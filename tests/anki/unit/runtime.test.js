'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANKI_NAMESPACE,
  initializeAnkiRuntime,
} = require('../../../src/anki/runtime');
const { createCaptureNotifier } = require('../../../src/anki/background-runtime');

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

test('capture notifier follows the current tab frame and removes failed deliveries', async () => {
  const sent = [];
  let fail = false;
  const notifier = createCaptureNotifier({
    tabs: {
      sendMessage(tabId, message, options) {
        sent.push({ tabId, message, options });
        return fail ? Promise.reject(new Error('frame gone')) : Promise.resolve();
      },
    },
  });
  const sender = { tab: { id: 7 }, frameId: 3 };
  notifier.track('capture-a', sender);
  notifier.track('capture-b', sender);
  notifier.notify({ captureId: 'capture-a', status: 'synced' });
  notifier.notify({ captureId: 'capture-b', status: 'waiting_anki' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].tabId, 7);
  assert.equal(sent[0].options.frameId, 3);
  assert.equal(sent[0].message.type, 'capture.changed');
  assert.equal(sent[0].message.payload.captureId, 'capture-b');

  fail = true;
  notifier.notify({ captureId: 'capture-b', status: 'synced' });
  await new Promise(resolve => setImmediate(resolve));
  notifier.notify({ captureId: 'capture-b', status: 'blocked' });
  assert.equal(sent.length, 2);
});
