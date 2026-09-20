'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IDBObjectStore,
  indexedDB,
} = require('fake-indexeddb');
const { openAnkiRepository } = require('../../../src/anki/repository');

let sequence = 0;
function databaseName(label) {
  sequence += 1;
  return `lingkuma-anki-test-${label}-${sequence}`;
}

function snapshot(overrides = {}) {
  return {
    language: 'en',
    term: 'yields',
    contextText: 'The iterator yields each record.',
    targetStart: 13,
    targetEnd: 19,
    contextQuality: 'sentence',
    fallbackSourceKey: '',
    source: { kind: 'web', url: 'https://example.test/article', title: 'Article' },
    ...overrides,
  };
}

test('20 concurrent create-or-get calls commit one capture and one enrich job', async () => {
  let now = 100;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('concurrent'), now: () => now++ });
  const results = await Promise.all(Array.from({ length: 20 }, () => repository.createOrGetCapture(snapshot())));

  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(new Set(results.map(result => result.capture.captureId)).size, 1);
  const page = await repository.listCaptures();
  assert.equal(page.items.length, 1);

  const firstJob = await repository.claimDueJob('enrich', 1_000, 'worker-a');
  const secondJob = await repository.claimDueJob('enrich', 1_000, 'worker-b');
  assert.equal(firstJob.captureId, results[0].capture.captureId);
  assert.equal(secondJob, null);
  repository.close();
});

test('capture and initial job roll back together when the job write fails', async () => {
  const name = databaseName('atomic');
  const repository = await openAnkiRepository({ indexedDB, name, now: () => 10 });
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function failJobAdd(value, key) {
    if (this.name === 'jobs') {
      throw new DOMException('quota', 'QuotaExceededError');
    }
    return originalAdd.call(this, value, key);
  };

  try {
    await assert.rejects(
      repository.createOrGetCapture(snapshot()),
      error => error.code === 'STORAGE_FAILED',
    );
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
  }

  assert.equal((await repository.listCaptures()).items.length, 0);
  repository.close();
});

test('committed data and expired jobs survive closing and reopening the database', async () => {
  const name = databaseName('restart');
  let repository = await openAnkiRepository({ indexedDB, name, now: () => 20 });
  const created = await repository.createOrGetCapture(snapshot());
  const claimed = await repository.claimDueJob('enrich', 20, 'dead-worker', 5);
  assert.equal(claimed.captureId, created.capture.captureId);
  repository.close();

  repository = await openAnkiRepository({ indexedDB, name, now: () => 30 });
  assert.equal((await repository.getCapture(created.capture.captureId)).captureId, created.capture.captureId);
  const reclaimed = await repository.claimDueJob('enrich', 30, 'new-worker', 5);
  assert.equal(reclaimed.jobId, claimed.jobId);
  assert.equal(reclaimed.leaseOwner, 'new-worker');
  repository.close();
});

test('stale revisions and expired lease owners cannot overwrite newer state', async () => {
  let now = 100;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('stale'), now: () => ++now });
  const { capture } = await repository.createOrGetCapture(snapshot());
  const edited = await repository.patchContent(capture.captureId, 0, { userNote: 'new note' });
  await assert.rejects(
    repository.patchContent(capture.captureId, 0, { userNote: 'stale note' }),
    error => error.code === 'STALE_REVISION' && error.details.current.contentRevision === 1,
  );
  assert.equal((await repository.getCapture(capture.captureId)).content.userNote, 'new note');

  const first = await repository.claimDueJob('enrich', 200, 'worker-a', 5);
  const second = await repository.claimDueJob('enrich', 206, 'worker-b', 5);
  assert.equal(first.jobId, second.jobId);
  assert.equal(await repository.commitJobResult(
    { jobId: first.jobId, ownerToken: 'worker-a' },
    edited.enrichmentGeneration,
    { contentPatch: { meaning: 'stale meaning' } },
  ), 'stale');
  assert.equal(await repository.commitJobResult(
    { jobId: second.jobId, ownerToken: 'worker-b' },
    edited.enrichmentGeneration,
    { contentPatch: { meaning: 'current meaning' } },
  ), 'committed');
  assert.equal((await repository.getCapture(capture.captureId)).content.meaning, 'current meaning');
  repository.close();
});

test('pending writes are durable and confirmation only clears fields actually observed', async () => {
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('pending'), now: () => 50 });
  const { capture } = await repository.createOrGetCapture(snapshot(), {
    content: { meaning: 'produce', userNote: 'local' },
  });
  await repository.prepareWrite(
    capture.captureId,
    0,
    { Meaning: 'produce', UserNote: 'local' },
    null,
    { opId: 'op-1', kind: 'create' },
  );
  const confirmed = await repository.confirmWrite('op-1', { Meaning: 'produce', UserNote: 'remote-other' }, 123);
  assert.equal(confirmed.link.pendingWrite, null);
  assert.equal(confirmed.link.noteIdHint, 123);
  assert.equal(confirmed.link.deliveryState, 'synced');
  assert.equal(confirmed.dirtyFields.includes('Meaning'), false);
  assert.equal(confirmed.dirtyFields.includes('UserNote'), true);
  repository.close();
});

test('an incompatible same-version database fails without destructive recovery', async () => {
  const name = databaseName('migration');
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('unrelated');
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });

  await assert.rejects(
    openAnkiRepository({ indexedDB, name }),
    error => error.code === 'STORAGE_FAILED',
  );
  const stores = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onsuccess = () => {
      const names = Array.from(request.result.objectStoreNames);
      request.result.close();
      resolve(names);
    };
    request.onerror = () => reject(request.error);
  });
  assert.deepEqual(stores, ['unrelated']);
});
