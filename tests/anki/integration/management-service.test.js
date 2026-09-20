'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { CaptureService } = require('../../../src/anki/capture-service');
const { ManagementService } = require('../../../src/anki/management-service');
const { ManagementStore } = require('../../../src/anki/management-store');
const { openAnkiRepository } = require('../../../src/anki/repository');
const { SyncService } = require('../../../src/anki/sync-service');
const { FakeAnki } = require('../support/fake-anki');

let sequence = 0;
function snapshot(index = 0, term = `term${index}`) {
  const contextText = `Context ${index} contains ${term} safely.`;
  const targetStart = contextText.indexOf(term);
  return {
    language: 'en', term, contextText, targetStart, targetEnd: targetStart + term.length,
    contextQuality: 'sentence', fallbackSourceKey: '',
    source: { kind: 'web', url: `https://example.test/${index}`, title: `Article ${index}` },
  };
}
function defaults(meaning = 'meaning') {
  return {
    content: { meaning },
    destination: { expectedProfile: 'User 1', deckName: 'LingKuma', modelName: 'LingKuma Lookup v1' },
  };
}
async function fixture() {
  let clock = 1_000;
  const repository = await openAnkiRepository({ indexedDB, name: `lingkuma-manager-${++sequence}`, now: () => ++clock });
  const anki = new FakeAnki();
  const syncService = new SyncService({ repository, ankiClient: anki, createOperationId: () => `op-${clock}`, now: () => clock });
  const captureService = new CaptureService({ repository });
  const management = new ManagementService({
    repository, managementStore: new ManagementStore(repository), captureService, syncService, ankiClient: anki,
  });
  async function drainPush(owner = `push-${clock}`) {
    const job = await repository.claimDueJob('push', clock + 10, owner, 30_000);
    return job ? syncService.processClaimedJob(job) : null;
  }
  return { repository, anki, syncService, captureService, management, drainPush };
}

test('management search paginates grouped terms and editing never creates captures', async () => {
  const f = await fixture();
  for (let index = 0; index < 35; index += 1) {
    await f.repository.createOrGetCapture(snapshot(index, index < 2 ? 'shared' : `term${index}`), defaults(`meaning ${index}`));
  }
  const first = await f.management.list({ query: 'meaning', limit: 20 });
  const second = await f.management.list({ query: 'meaning', cursor: first.nextCursor, limit: 20 });
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 15);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.captureId)).size, 35);
  const shared = await f.management.list({ query: 'shared', limit: 10 });
  assert.equal(shared.items.length, 2);
  assert.equal(shared.items.every(item => item.content.term === 'shared'), true);

  const target = shared.items[0];
  const edited = await f.management.edit({
    captureId: target.captureId, expectedRevision: target.contentRevision,
    patch: { meaning: 'edited meaning', userNote: 'my note' },
  });
  assert.equal(edited.content.meaning, 'edited meaning');
  assert.equal(edited.content.userNote, 'my note');
  assert.equal((await f.management.list({ limit: 100 })).items.length, 35);
  await assert.rejects(() => f.management.edit({ captureId: target.captureId, expectedRevision: target.contentRevision, patch: { meaning: 'stale' } }), error => error.code === 'STALE_REVISION');
  f.repository.close();
});

test('stop management preserves identity and remote note; only explicit resume reactivates it', async () => {
  const f = await fixture();
  const created = await f.repository.createOrGetCapture(snapshot(1, 'record'), defaults());
  await f.drainPush();
  const captureId = created.capture.captureId;
  assert.equal(f.anki.notes.size, 1);
  const excluded = await f.management.exclude({ captureId });
  assert.equal(excluded.status, 'excluded');
  const lookupAgain = await f.repository.createOrGetCapture(snapshot(1, 'record'), defaults());
  assert.equal(lookupAgain.created, false);
  assert.equal(lookupAgain.capture.active, false);
  assert.equal(f.anki.notes.size, 1);
  assert.equal((await f.repository.getJobSchedule()).count, 0);
  await assert.rejects(() => f.management.edit({ captureId, expectedRevision: excluded.contentRevision, patch: { userNote: 'hidden edit' } }), error => error.code === 'INPUT_INVALID');

  const resumed = await f.management.resume({ captureId });
  assert.equal(resumed.active, true);
  assert.equal((await f.repository.getJobSchedule()).count, 0);
  assert.equal(f.anki.notes.size, 1);
  f.repository.close();
});

test('conflict view exposes both versions and resolution rechecks Anki before applying', async () => {
  const f = await fixture();
  const created = await f.repository.createOrGetCapture(snapshot(2, 'delta'), defaults('local base'));
  await f.drainPush('create');
  let capture = await f.repository.getCapture(created.capture.captureId);
  const note = f.anki.notes.get(capture.link.noteIdHint);
  note.fields.Meaning = 'remote edit';
  await f.management.edit({ captureId: capture.captureId, expectedRevision: capture.contentRevision, patch: { meaning: 'local edit' } });
  assert.equal((await f.drainPush('conflict')).status, 'conflict');

  const listed = await f.management.list({ state: 'conflict' });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].localFields.Meaning, 'local edit');
  assert.equal(listed.items[0].remoteFields.Meaning, 'remote edit');
  capture = await f.repository.getCapture(capture.captureId);
  const resolved = await f.management.resolve({ captureId: capture.captureId, expectedRevision: capture.contentRevision, strategy: 'remote', localFields: [] });
  assert.equal(note.fields.Meaning, 'remote edit');

  note.fields.Meaning = 'changed again';
  await f.management.edit({ captureId: capture.captureId, expectedRevision: resolved.contentRevision, patch: { meaning: 'another local edit' } });
  assert.equal((await f.drainPush('second-conflict')).status, 'conflict');
  capture = await f.repository.getCapture(capture.captureId);
  note.fields.Meaning = 'changed after review';
  await assert.rejects(() => f.management.resolve({ captureId: capture.captureId, expectedRevision: capture.contentRevision, strategy: 'local', localFields: [] }), error => error.code === 'REMOTE_CHANGED');
  f.repository.close();
});

test('multiple identity matches show a retryable error without writing either note', async () => {
  const f = await fixture();
  const created = await f.repository.createOrGetCapture(snapshot(4, 'duplicate'), defaults());
  await f.drainPush('create');
  let capture = await f.repository.getCapture(created.capture.captureId);
  const original = f.anki.notes.get(capture.link.noteIdHint);
  const duplicateId = f.anki.seedNote({ fields: original.fields });
  await f.management.edit({
    captureId: capture.captureId,
    expectedRevision: capture.contentRevision,
    patch: { userNote: 'must not write ambiguously' },
  });
  assert.equal((await f.drainPush('multiple')).status, 'conflict');
  const item = (await f.management.list({ state: 'conflict' })).items[0];
  assert.equal(item.lastError.code, 'MULTIPLE_MATCHES');
  assert.equal(item.remoteFields, null);
  assert.equal(f.anki.countCalls('updateNoteFields'), 0);

  f.anki.notes.delete(duplicateId);
  capture = await f.repository.getCapture(capture.captureId);
  const retried = await f.management.retry({ captureId: capture.captureId, expectedRevision: capture.contentRevision });
  assert.equal(retried.status, 'waiting_anki');
  assert.equal((await f.drainPush('single')).status, 'committed');
  f.repository.close();
});

test('missing note requires explicit recreate and linked note opening revalidates identity', async () => {
  const f = await fixture();
  const created = await f.repository.createOrGetCapture(snapshot(3, 'missing'), defaults());
  await f.drainPush('create');
  let capture = await f.repository.getCapture(created.capture.captureId);
  await f.management.openInAnki({ captureId: capture.captureId });
  assert.equal(f.anki.countCalls('guiBrowse'), 1);
  await f.management.edit({
    captureId: capture.captureId,
    expectedRevision: capture.contentRevision,
    patch: { userNote: 'managed edit' },
  });
  assert.equal((await f.drainPush('managed-update')).status, 'committed');
  assert.equal(f.anki.countCalls('addNote'), 1);
  assert.equal(f.anki.countCalls('updateNoteFields'), 1);
  capture = await f.repository.getCapture(capture.captureId);

  f.anki.notes.delete(capture.link.noteIdHint);
  await f.management.edit({ captureId: capture.captureId, expectedRevision: capture.contentRevision, patch: { userNote: 'changed' } });
  assert.equal((await f.drainPush('missing')).status, 'remote_missing');
  capture = await f.repository.getCapture(capture.captureId);
  assert.equal(capture.link.deliveryState, 'remote_missing');
  assert.equal(await f.drainPush('no-implicit-recreate'), null);
  assert.equal(f.anki.countCalls('addNote'), 1);

  const requested = await f.management.retry({ captureId: capture.captureId, expectedRevision: capture.contentRevision });
  assert.equal(requested.status, 'waiting_anki');
  assert.equal((await f.drainPush('explicit-recreate')).status, 'committed');
  assert.equal(f.anki.countCalls('addNote'), 2);
  assert.equal(f.anki.notes.size, 1);
  f.repository.close();
});
