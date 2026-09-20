'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { ContractError } = require('../../../src/anki/contracts');
const { openAnkiRepository } = require('../../../src/anki/repository');
const { SyncService } = require('../../../src/anki/sync-service');
const { FakeAnki } = require('../support/fake-anki');

let sequence = 0;
function databaseName(label) {
  sequence += 1;
  return `lingkuma-sync-update-${label}-${sequence}`;
}

function snapshot() {
  return {
    language: 'en',
    term: 'yields',
    contextText: 'The iterator yields each record.',
    targetStart: 13,
    targetEnd: 19,
    contextQuality: 'sentence',
    fallbackSourceKey: '',
    source: { kind: 'web', url: 'https://example.test/article', title: 'Article' },
  };
}

function defaults() {
  return {
    content: { meaning: '产生' },
    destination: {
      expectedProfile: 'User 1',
      deckName: 'LingKuma',
      modelName: 'LingKuma Lookup v1',
    },
  };
}

function service(repository, fake, now) {
  let operation = 0;
  return new SyncService({
    repository,
    ankiClient: fake,
    createOperationId: () => `update-operation-${++operation}`,
    now,
  });
}

async function runDue(repository, coordinator, clock, owner = `worker-${clock}`) {
  const job = await repository.claimDueJob('push', clock, owner);
  assert.ok(job, 'expected a due push job');
  return coordinator.processClaimedJob(job);
}

async function createSynced(repository, fake, coordinator, clock) {
  const { capture } = await repository.createOrGetCapture(snapshot(), defaults());
  const result = await runDue(repository, coordinator, clock, 'create-worker');
  assert.equal(result.status, 'committed');
  return repository.getCapture(capture.captureId);
}

test('local edits update only dirty fields on the original note without touching review state', async () => {
  let clock = 1_000;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('in-place'), now: () => clock });
  const fake = new FakeAnki();
  const coordinator = service(repository, fake, () => clock);
  let capture = await createSynced(repository, fake, coordinator, clock);
  const noteId = capture.link.noteIdHint;
  const originalReview = structuredClone(fake.notes.get(noteId).review);
  const originalTags = [...fake.notes.get(noteId).tags];

  clock += 1;
  capture = await repository.patchContent(capture.captureId, capture.contentRevision, {
    meaning: '逐个产生记录',
    userNote: 'Remember the lazy behavior.',
  });
  const result = await runDue(repository, coordinator, clock, 'update-worker');

  assert.equal(result.status, 'committed');
  assert.equal(fake.countCalls('addNote'), 1);
  assert.equal(fake.countCalls('updateNoteFields'), 1);
  const update = fake.calls.find(call => call.action === 'updateNoteFields');
  assert.equal(update.noteId, noteId);
  assert.deepEqual(Object.keys(update.fields).sort(), ['Meaning', 'UserNote']);
  assert.deepEqual(fake.notes.get(noteId).review, originalReview);
  assert.deepEqual(fake.notes.get(noteId).tags, originalTags);
  assert.deepEqual((await repository.getCapture(capture.captureId)).dirtyFields, []);
  repository.close();
});

test('remote rich text is preserved after accepting remote and later editing only UserNote', async () => {
  let clock = 2_000;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('remote-rich'), now: () => clock });
  const fake = new FakeAnki();
  const coordinator = service(repository, fake, () => clock);
  let capture = await createSynced(repository, fake, coordinator, clock);
  const note = fake.notes.get(capture.link.noteIdHint);
  note.fields.Meaning = '<div><b>remote</b> meaning</div>';

  clock += 1;
  capture = await repository.patchContent(capture.captureId, capture.contentRevision, {
    userNote: 'local draft',
  });
  const conflict = await runDue(repository, coordinator, clock, 'conflict-worker');
  assert.equal(conflict.status, 'conflict');
  assert.equal(fake.countCalls('updateNoteFields'), 0);

  const accepted = await coordinator.resolveConflict({
    captureId: capture.captureId,
    expectedRevision: capture.contentRevision,
    strategy: 'remote',
  });
  assert.equal(accepted.status, 'synced');
  capture = await repository.getCapture(capture.captureId);
  assert.equal(capture.link.baseFields.Meaning, '<div><b>remote</b> meaning</div>');
  assert.deepEqual(capture.dirtyFields, []);

  clock += 1;
  capture = await repository.patchContent(capture.captureId, capture.contentRevision, {
    userNote: 'chosen note',
  });
  const updated = await runDue(repository, coordinator, clock, 'note-worker');
  assert.equal(updated.status, 'committed');
  const update = fake.calls.find(call => call.action === 'updateNoteFields');
  assert.deepEqual(Object.keys(update.fields), ['UserNote']);
  assert.equal(note.fields.Meaning, '<div><b>remote</b> meaning</div>');
  assert.deepEqual((await repository.getCapture(capture.captureId)).dirtyFields, []);
  repository.close();
});

test('conflict resolution re-reads remote and supports explicit local field selection', async () => {
  let clock = 3_000;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('resolution'), now: () => clock });
  const fake = new FakeAnki();
  const coordinator = service(repository, fake, () => clock);
  let capture = await createSynced(repository, fake, coordinator, clock);
  const note = fake.notes.get(capture.link.noteIdHint);
  note.fields.Meaning = 'remote version one';
  clock += 1;
  capture = await repository.patchContent(capture.captureId, capture.contentRevision, {
    meaning: 'local version',
    userNote: 'local note',
  });
  assert.equal((await runDue(repository, coordinator, clock, 'detect-worker')).status, 'conflict');

  note.fields.Meaning = 'remote version two';
  await assert.rejects(
    coordinator.resolveConflict({
      captureId: capture.captureId,
      expectedRevision: capture.contentRevision,
      strategy: 'fields',
      localFields: ['UserNote'],
    }),
    error => error.code === 'REMOTE_CHANGED',
  );
  const latest = await repository.getCapture(capture.captureId);
  assert.equal(latest.link.observedRemoteFields.Meaning, 'remote version two');

  const selected = await coordinator.resolveConflict({
    captureId: capture.captureId,
    expectedRevision: capture.contentRevision,
    strategy: 'fields',
    localFields: ['UserNote'],
  });
  assert.equal(selected.status, 'waiting_anki');
  assert.deepEqual((await repository.getCapture(capture.captureId)).dirtyFields, ['UserNote']);
  assert.equal((await runDue(repository, coordinator, clock, 'resolve-worker')).status, 'committed');
  assert.equal(note.fields.Meaning, 'remote version two');
  assert.equal(note.fields.UserNote, 'local note');
  repository.close();
});

test('choosing the local conflict version queues an in-place update', async () => {
  const clock = 3_500;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('local-resolution'), now: () => clock });
  const fake = new FakeAnki();
  const coordinator = service(repository, fake, () => clock);
  let capture = await createSynced(repository, fake, coordinator, clock);
  const note = fake.notes.get(capture.link.noteIdHint);
  note.fields.Meaning = 'remote edit';
  capture = await repository.patchContent(capture.captureId, capture.contentRevision, {
    meaning: 'chosen local edit',
  });
  assert.equal((await runDue(repository, coordinator, clock, 'local-detect')).status, 'conflict');

  const resolved = await coordinator.resolveConflict({
    captureId: capture.captureId,
    expectedRevision: capture.contentRevision,
    strategy: 'local',
  });
  assert.equal(resolved.status, 'waiting_anki');
  assert.equal((await runDue(repository, coordinator, clock, 'local-apply')).status, 'committed');
  assert.equal(note.fields.Meaning, 'chosen local edit');
  repository.close();
});

test('a lost update response is recognized as the pending write and is not replayed', async () => {
  let clock = 4_000;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('lost-update'), now: () => clock });
  const fake = new FakeAnki();
  const coordinator = service(repository, fake, () => clock);
  let capture = await createSynced(repository, fake, coordinator, clock);
  clock += 1;
  capture = await repository.patchContent(capture.captureId, capture.contentRevision, { meaning: 'updated once' });
  fake.afterUpdate = async () => {
    fake.afterUpdate = null;
    throw new ContractError('TIMEOUT', 'response lost', { retryable: true });
  };

  const result = await runDue(repository, coordinator, clock, 'lost-worker');
  assert.equal(result.status, 'committed');
  assert.equal(fake.countCalls('updateNoteFields'), 1);
  const stored = await repository.getCapture(capture.captureId);
  assert.equal(stored.link.deliveryState, 'synced');
  assert.equal(stored.link.pendingWrite, null);
  repository.close();
});

test('an update not observed remotely remains pending and is retried only after reconciliation', async () => {
  let clock = 4_500;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('not-applied'), now: () => clock });
  const fake = new FakeAnki();
  const coordinator = service(repository, fake, () => clock);
  let capture = await createSynced(repository, fake, coordinator, clock);
  capture = await repository.patchContent(capture.captureId, capture.contentRevision, { meaning: 'retry safely' });
  const realUpdate = fake.updateNoteFields.bind(fake);
  let failBeforeWrite = true;
  fake.updateNoteFields = async (noteId, fields) => {
    if (failBeforeWrite) {
      failBeforeWrite = false;
      fake.calls.push({ action: 'updateNoteFields', noteId, fields: structuredClone(fields) });
      throw new ContractError('TIMEOUT', 'request did not arrive', { retryable: true });
    }
    return realUpdate(noteId, fields);
  };

  const first = await runDue(repository, coordinator, clock, 'failed-write');
  assert.equal(first.status, 'retry_scheduled');
  assert.ok((await repository.getCapture(capture.captureId)).link.pendingWrite);
  clock += 5_000;
  const second = await runDue(repository, coordinator, clock, 'retry-write');
  assert.equal(second.status, 'committed');
  assert.equal(fake.countCalls('updateNoteFields'), 2);
  assert.equal((await repository.getCapture(capture.captureId)).link.pendingWrite, null);
  repository.close();
});

test('an edit made during update remains dirty and is delivered by the replacement job', async () => {
  let clock = 5_000;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('concurrent-edit'), now: () => clock });
  const fake = new FakeAnki();
  const coordinator = service(repository, fake, () => clock);
  let capture = await createSynced(repository, fake, coordinator, clock);
  clock += 1;
  capture = await repository.patchContent(capture.captureId, capture.contentRevision, { meaning: 'first edit' });
  fake.afterUpdate = async () => {
    fake.afterUpdate = null;
    const current = await repository.getCapture(capture.captureId);
    await repository.patchContent(capture.captureId, current.contentRevision, { userNote: 'second edit' });
  };

  const first = await runDue(repository, coordinator, clock, 'old-revision-worker');
  assert.equal(first.status, 'stale');
  let stored = await repository.getCapture(capture.captureId);
  assert.deepEqual(stored.dirtyFields, ['UserNote']);
  assert.equal(stored.link.baseFields.Meaning, 'first edit');

  const second = await runDue(repository, coordinator, clock, 'new-revision-worker');
  assert.equal(second.status, 'committed');
  stored = await repository.getCapture(capture.captureId);
  assert.deepEqual(stored.dirtyFields, []);
  assert.equal(fake.countCalls('updateNoteFields'), 2);
  repository.close();
});

test('deleted and mismatched hinted notes are never overwritten and recreation is explicit', async () => {
  let clock = 6_000;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('missing'), now: () => clock });
  const fake = new FakeAnki();
  const coordinator = service(repository, fake, () => clock);
  let capture = await createSynced(repository, fake, coordinator, clock);
  const oldNoteId = capture.link.noteIdHint;
  fake.notes.delete(oldNoteId);
  const foreignFields = { ...capture.link.baseFields, CaptureId: `lk1_${'a'.repeat(64)}`, Meaning: 'foreign' };
  fake.seedNote({ noteId: oldNoteId, fields: foreignFields });
  clock += 1;
  capture = await repository.patchContent(capture.captureId, capture.contentRevision, { meaning: 'local after delete' });

  const missing = await runDue(repository, coordinator, clock, 'missing-worker');
  assert.equal(missing.status, 'remote_missing');
  assert.equal(fake.countCalls('updateNoteFields'), 0);
  assert.equal(fake.notes.get(oldNoteId).fields.Meaning, 'foreign');
  assert.equal(await repository.claimDueJob('push', clock, 'implicit-recreate'), null);

  const requested = await coordinator.recreateMissing({
    captureId: capture.captureId,
    expectedRevision: capture.contentRevision,
  });
  assert.equal(requested.status, 'waiting_anki');
  assert.equal((await runDue(repository, coordinator, clock, 'explicit-recreate')).status, 'committed');
  assert.equal(fake.countCalls('addNote'), 2);
  assert.equal(fake.notes.get(oldNoteId).fields.Meaning, 'foreign');
  repository.close();
});
