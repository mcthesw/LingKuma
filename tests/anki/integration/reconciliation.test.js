'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { AssociationStore } = require('../../../src/anki/association-store');
const { JobScheduler } = require('../../../src/anki/scheduler');
const { renderFields } = require('../../../src/anki/note-model');
const { ReconciliationService } = require('../../../src/anki/reconciliation-service');
const { openAnkiRepository } = require('../../../src/anki/repository');
const { SyncService } = require('../../../src/anki/sync-service');
const { FakeAnki } = require('../support/fake-anki');

let sequence = 0;
const destination = {
  expectedProfile: 'User 1',
  deckName: 'LingKuma',
  modelName: 'LingKuma Lookup v1',
};

function snapshot(contextText = 'The iterator yields each record.') {
  const term = 'yields';
  const targetStart = contextText.indexOf(term);
  return {
    language: 'en', term, contextText, targetStart, targetEnd: targetStart + term.length,
    contextQuality: 'sentence', fallbackSourceKey: '',
    source: { kind: 'web', url: 'https://example.test/article', title: 'Article' },
  };
}

async function repositoryFor(label, now) {
  sequence += 1;
  return openAnkiRepository({ indexedDB, name: `lingkuma-reconcile-${label}-${sequence}`, now });
}

async function push(repository, fake, at, owner = 'push') {
  const job = await repository.claimDueJob('push', at, owner);
  assert.ok(job);
  return new SyncService({
    repository,
    ankiClient: fake,
    createOperationId: () => `${owner}-operation`,
    now: () => at,
  }).processClaimedJob(job);
}

async function createLinked(repository, fake, at, contextText) {
  const { capture } = await repository.createOrGetCapture(snapshot(contextText), {
    content: { meaning: '产生' }, destination,
  });
  assert.equal((await push(repository, fake, at, `push-${capture.captureId}`)).status, 'committed');
  return repository.getCapture(capture.captureId);
}

function alarmClock() {
  let alarm = null;
  return {
    async get() { return alarm; },
    async create(name, when) { alarm = { name, scheduledTime: when }; },
    async clear() { alarm = null; return true; },
  };
}

function scheduler(repository, reconciliationService, now) {
  return new JobScheduler({
    repository,
    enrichmentCoordinator: { processNext: async () => ({ status: 'idle' }) },
    syncService: { processClaimedJob: async () => ({ status: 'idle' }) },
    mediaService: { processClaimedJob: async () => ({ status: 'idle' }) },
    reconciliationService,
    alarmClock: alarmClock(),
    now,
    monotonicNow: (() => { let value = 0; return () => ++value; })(),
  });
}

test('A41 existing CaptureId is adopted without add or overwrite, while prior manual edits conflict', async () => {
  const now = () => 100;
  const repository = await repositoryFor('adopt', now);
  const fake = new FakeAnki();
  const first = await repository.createOrGetCapture(snapshot(), {
    content: { meaning: 'generated meaning' }, destination,
  });
  const remoteFields = { ...renderFields(first.capture), Meaning: 'meaning edited in Anki' };
  const noteId = fake.seedNote({ fields: remoteFields });

  const adopted = await push(repository, fake, now(), 'adopt-worker');
  assert.equal(adopted.status, 'committed');
  assert.equal(adopted.noteId, noteId);
  assert.equal(fake.countCalls('addNote'), 0);
  assert.equal(fake.countCalls('updateNoteFields'), 0);
  const stored = await repository.getCapture(first.capture.captureId);
  assert.equal(stored.link.deliveryState, 'synced');
  assert.equal(stored.link.baseFields.Meaning, 'meaning edited in Anki');
  assert.deepEqual(stored.dirtyFields, []);
  assert.equal(fake.notes.get(noteId).fields.Meaning, 'meaning edited in Anki');

  const second = await repository.createOrGetCapture(snapshot('This function yields control briefly.'), {
    content: { meaning: 'generated second meaning' }, destination,
  });
  await repository.patchContent(second.capture.captureId, 0, { meaning: 'manual local meaning' });
  fake.seedNote({ fields: { ...renderFields(second.capture), Meaning: 'remote second meaning' } });
  const conflict = await push(repository, fake, now(), 'manual-worker');
  assert.equal(conflict.status, 'conflict');
  assert.equal(fake.countCalls('addNote'), 0);
  assert.equal(fake.countCalls('updateNoteFields'), 0);
  assert.equal((await repository.getCapture(second.capture.captureId)).link.observedRemoteFields.Meaning, 'remote second meaning');
  repository.close();
});

test('A42 scheduled local inspection detects edit, deletion, noteId change, and duplicate identity', async () => {
  let clock = 1_000;
  const now = () => clock;
  const repository = await repositoryFor('scheduled', now);
  const fake = new FakeAnki();
  const edited = await createLinked(repository, fake, clock, 'The iterator yields each record.');
  const deleted = await createLinked(repository, fake, clock, 'This function yields control briefly.');
  const moved = await createLinked(repository, fake, clock, 'A generator yields values lazily.');
  const duplicated = await createLinked(repository, fake, clock, 'The API yields a response.');
  const associationStore = new AssociationStore(repository, { intervalMs: 100 });
  const service = new ReconciliationService({ repository, associationStore, ankiClient: fake, now });

  fake.notes.get(edited.link.noteIdHint).fields.Meaning = 'external edit';
  fake.notes.delete(deleted.link.noteIdHint);
  const movedNote = fake.notes.get(moved.link.noteIdHint);
  fake.notes.delete(moved.link.noteIdHint);
  const newNoteId = 9_001;
  fake.seedNote({ ...movedNote, noteId: newNoteId });
  fake.seedNote({ fields: { ...duplicated.link.baseFields } });
  clock += 100;
  const result = await scheduler(repository, service, now).scheduleDrain('inspection_due');
  assert.equal(result.processed, 4);

  assert.equal((await repository.getCapture(edited.captureId)).link.deliveryState, 'conflict');
  assert.equal((await repository.getCapture(edited.captureId)).link.observedRemoteFields.Meaning, 'external edit');
  assert.equal((await repository.getCapture(deleted.captureId)).link.deliveryState, 'remote_missing');
  const rebound = await repository.getCapture(moved.captureId);
  assert.equal(rebound.link.deliveryState, 'synced');
  assert.equal(rebound.link.noteIdHint, newNoteId);
  assert.equal((await repository.getCapture(duplicated.captureId)).link.lastError.code, 'MULTIPLE_MATCHES');
  assert.equal(fake.countCalls('addNote'), 4);
  assert.equal(fake.countCalls('updateNoteFields'), 0);
  assert.equal(fake.calls.some(call => ['sync', 'loadProfile', 'changeDeck'].includes(call.action)), false);
  assert.equal(fake.calls.filter(call => call.action === 'findNotes').length, 12);
  repository.close();
});

test('immediate inspection persists external state before management operations', async () => {
  let clock = 2_000;
  const now = () => clock;
  const repository = await repositoryFor('immediate', now);
  const fake = new FakeAnki();
  const capture = await createLinked(repository, fake, clock);
  const associationStore = new AssociationStore(repository, { intervalMs: 100 });
  const service = new ReconciliationService({ repository, associationStore, ankiClient: fake, now });
  fake.notes.get(capture.link.noteIdHint).fields.Usage = 'changed outside LingKuma';

  const inspected = await service.inspectNow(capture.captureId);
  assert.equal(inspected.status, 'conflict');
  const stored = await repository.getCapture(capture.captureId);
  assert.equal(stored.link.observedRemoteFields.Usage, 'changed outside LingKuma');
  assert.equal(fake.countCalls('updateNoteFields'), 0);
  repository.close();
});
