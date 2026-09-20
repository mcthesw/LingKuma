'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  captureStatusText,
  createWordLookupController,
  freezeWordOriginSnapshot,
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
