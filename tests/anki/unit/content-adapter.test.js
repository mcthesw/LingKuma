'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  captureStatusText,
  createWordLookupController,
  disposeLookupController,
  freezeWordOriginSnapshot,
  installContentFacade,
  isSensitiveSelectionTarget,
} = require('../../../src/anki/content-adapter');

function capture(captureId, status, meaning = '') {
  return {
    captureId,
    status,
    content: { meaning },
    contentRevision: meaning ? 1 : 0,
  };
}

function facadeFixture() {
  const listeners = new Set();
  const lookups = [];
  const facade = {
    lookups,
    captureLookup(payload) {
      return new Promise(resolve => lookups.push({ payload, resolve }));
    },
    async lookupState({ captureId }) {
      return capture(captureId, 'waiting_content');
    },
    onCaptureChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify(value) {
      for (const listener of [...listeners]) listener(value);
    },
  };
  return facade;
}

test('word snapshot uses exact cross-node range offsets and real source', () => {
  const startContainer = {};
  const contextRange = {
    toString: () => 'Alpha yields records.',
    cloneRange() {
      return {
        setEnd(container, offset) {
          assert.equal(container, startContainer);
          assert.equal(offset, 0);
        },
        toString: () => 'Alpha ',
      };
    },
  };
  const snapshot = freezeWordOriginSnapshot({
    contextRange,
    targetRange: { toString: () => 'yields', startContainer, startOffset: 0 },
    language: 'en',
    source: { kind: 'web', url: 'https://example.test/article', title: 'Article' },
  });

  assert.equal(snapshot.contextText.slice(snapshot.targetStart, snapshot.targetEnd), 'yields');
  assert.deepEqual(snapshot.source, {
    kind: 'web',
    url: 'https://example.test/article',
    title: 'Article',
  });
});

test('lookup controller reports committed state, recovers races and rejects stale capture updates', async () => {
  const facade = facadeFixture();
  const updatesA = [];
  const updatesB = [];
  let session = 0;
  const scope = { crypto: { randomUUID: () => `lookup-${++session}` } };
  const first = createWordLookupController({ facade, originSnapshot: {}, onUpdate: value => updatesA.push(value), scope });
  const second = createWordLookupController({ facade, originSnapshot: {}, onUpdate: value => updatesB.push(value), scope });

  facade.lookups[1].resolve({
    lookupSessionId: 'lookup-2',
    captureId: 'capture-b',
    persisted: true,
    paused: false,
    capture: capture('capture-b', 'waiting_content'),
  });
  await second.ready;
  facade.lookups[0].resolve({
    lookupSessionId: 'lookup-1',
    captureId: 'capture-a',
    persisted: true,
    paused: false,
    capture: capture('capture-a', 'waiting_content'),
  });
  await first.ready;

  facade.notify(capture('capture-a', 'synced', '产生'));
  assert.equal(updatesA.at(-1).text, '已写入 Anki');
  assert.notEqual(updatesB.at(-1).capture?.captureId, 'capture-a');
  first.dispose();
  facade.notify(capture('capture-a', 'blocked', '产生'));
  assert.equal(updatesA.at(-1).text, '已写入 Anki');
  second.dispose();
});

test('paused lookup remains a normal non-persisting UI state', async () => {
  const facade = facadeFixture();
  const updates = [];
  const controller = createWordLookupController({
    facade,
    originSnapshot: {},
    onUpdate: value => updates.push(value),
    scope: { crypto: { randomUUID: () => 'lookup-paused' } },
  });
  facade.lookups[0].resolve({
    lookupSessionId: 'lookup-paused',
    captureId: null,
    persisted: false,
    paused: true,
    capture: null,
  });
  await controller.ready;

  assert.equal(updates.at(-1).phase, 'paused');
  assert.equal(updates.at(-1).text, 'Anki 自动摘录已暂停');
  assert.equal(captureStatusText(null, { paused: true }), updates.at(-1).text);
  controller.dispose();
});

test('content facade reinjection keeps one listener and exposes only narrow capture requests', async () => {
  const runtimeListeners = [];
  const messages = [];
  const browserApi = {
    runtime: {
      lastError: null,
      onMessage: { addListener: listener => runtimeListeners.push(listener) },
      sendMessage(message, callback) {
        messages.push(message);
        callback({ ok: true, requestId: message.requestId, data: { captureId: 'capture-a' } });
      },
    },
  };
  const scope = { crypto: { randomUUID: () => 'request-1' } };
  const first = installContentFacade({ browserApi, scope });
  const second = installContentFacade({ browserApi, scope });
  assert.equal(first, second);
  assert.equal(runtimeListeners.length, 1);
  assert.equal(first.listCaptures, undefined);
  assert.equal(first.exportBackup, undefined);
  assert.equal(first.saveSettings, undefined);

  let delivered = 0;
  first.onCaptureChanged(() => { throw new Error('renderer failed'); });
  first.onCaptureChanged(() => { delivered += 1; });
  runtimeListeners[0]({
    namespace: 'lingkuma.anki.v1',
    type: 'capture.changed',
    payload: { captureId: 'capture-a' },
  });
  assert.equal(delivered, 1);
  await first.captureLookup({ lookupSessionId: 'lookup-1', originSnapshot: {} });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'capture.lookup');
});

test('selection guard rejects form controls and editable regions without blocking article text', () => {
  function element(selector, parentElement = null, contenteditable = null) {
    return {
      nodeType: 1,
      parentElement,
      matches(query) {
        if (query === 'input, textarea, select') return query.split(', ').includes(selector);
        return query === '[contenteditable]' && contenteditable !== null;
      },
      getAttribute(name) {
        return name === 'contenteditable' ? contenteditable : null;
      },
      getRootNode: () => ({ host: null }),
    };
  }
  const article = element('article');
  const input = element('input', article);
  const editable = element('div', article, 'true');
  const nested = element('span', editable);
  const shadowText = element('span');
  shadowText.getRootNode = () => ({ host: editable });
  assert.equal(isSensitiveSelectionTarget({ selection: { anchorNode: input, focusNode: input, rangeCount: 0 } }), true);
  assert.equal(isSensitiveSelectionTarget({ selection: { anchorNode: nested, focusNode: nested, rangeCount: 0 } }), true);
  assert.equal(isSensitiveSelectionTarget({ selection: { anchorNode: shadowText, focusNode: shadowText, rangeCount: 0 } }), true);
  assert.equal(isSensitiveSelectionTarget({ selection: { anchorNode: article, focusNode: article, rangeCount: 0 } }), false);
});

test('tooltip lookup disposal runs once and clears the controller reference', () => {
  let disposals = 0;
  const target = { _ankiLookupController: { dispose: () => { disposals += 1; } } };
  disposeLookupController(target);
  disposeLookupController(target);
  assert.equal(disposals, 1);
  assert.equal(Object.hasOwn(target, '_ankiLookupController'), false);
});
