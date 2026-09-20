'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { ContractError } = require('../../../src/anki/contracts');
const { renderFields } = require('../../../src/anki/note-model');
const { openAnkiRepository } = require('../../../src/anki/repository');
const { SyncService } = require('../../../src/anki/sync-service');
const { FakeAnki } = require('../support/fake-anki');

let sequence = 0;
function databaseName(label) {
  sequence += 1;
  return `lingkuma-sync-create-${label}-${sequence}`;
}

function snapshot(contextText = 'The iterator yields each record.') {
  const term = 'yields';
  const targetStart = contextText.indexOf(term);
  return {
    language: 'en',
    term,
    contextText,
    targetStart,
    targetEnd: targetStart + term.length,
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

function operationIds() {
  let value = 0;
  return () => `operation-${++value}`;
}

async function readyCapture(repository, contextText) {
  return repository.createOrGetCapture(snapshot(contextText), defaults());
}

async function runPush(repository, fake, clock, owner = 'push-worker') {
  const job = await repository.claimDueJob('push', clock, owner);
  assert.ok(job, 'expected a due push job');
  const service = new SyncService({
    repository,
    ankiClient: fake,
    createOperationId: operationIds(),
    now: () => clock,
  });
  return service.processClaimedJob(job);
}

test('valid content is created without UI and only marked synced after exact readback', async () => {
  const clock = 100;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('normal'), now: () => clock });
  const { capture } = await readyCapture(repository);
  const fake = new FakeAnki();
  const result = await runPush(repository, fake, clock);

  assert.equal(result.status, 'committed');
  assert.equal(fake.notes.size, 1);
  assert.equal(fake.countCalls('addNote'), 1);
  assert.equal(fake.calls.some(call => call.action === 'guiAddCards'), false);
  const add = fake.calls.find(call => call.action === 'addNote').note;
  assert.equal(Object.keys(add.fields)[0], 'CaptureId');
  assert.equal(add.fields.CaptureId, capture.captureId);
  assert.equal(add.options.allowDuplicate, false);
  const stored = await repository.getCapture(capture.captureId);
  assert.equal(stored.link.deliveryState, 'synced');
  assert.equal(stored.link.wasLinked, true);
  assert.equal(stored.link.pendingWrite, null);
  assert.equal(stored.link.baseFields.CaptureId, capture.captureId);
  assert.equal(stored.link.noteIdHint, result.noteId);
  assert.ok(stored.link.lastVerifiedAt);
  assert.ok(fake.calls.findIndex(call => call.action === 'findNotes')
    < fake.calls.findIndex(call => call.action === 'addNote'));
  assert.ok(fake.calls.findLastIndex(call => call.action === 'notesInfo')
    > fake.calls.findIndex(call => call.action === 'addNote'));
  repository.close();
});

test('a lost add response is reconciled by CaptureId without a second add', async () => {
  let clock = 200;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('lost-response'), now: () => clock });
  const { capture } = await readyCapture(repository);
  const fake = new FakeAnki();
  fake.afterAdd = async () => {
    fake.afterAdd = null;
    throw new ContractError('TIMEOUT', 'response lost', { retryable: true });
  };
  const result = await runPush(repository, fake, clock);

  assert.equal(result.status, 'committed');
  assert.equal(fake.notes.size, 1);
  assert.equal(fake.countCalls('addNote'), 1);
  assert.equal((await repository.getCapture(capture.captureId)).link.deliveryState, 'synced');
  repository.close();
});

test('a duplicate error caused by a lookup race is re-queried and reconciled', async () => {
  const clock = 250;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('duplicate-race'), now: () => clock });
  const { capture } = await readyCapture(repository);
  const fake = new FakeAnki();
  fake.seedNote({ fields: renderFields(capture) });
  const realFind = fake.findNotesByCaptureId.bind(fake);
  let firstLookup = true;
  fake.findNotesByCaptureId = async captureId => {
    if (firstLookup) {
      firstLookup = false;
      fake.calls.push({ action: 'findNotes', captureId });
      return [];
    }
    return realFind(captureId);
  };

  const result = await runPush(repository, fake, clock);
  assert.equal(result.status, 'committed');
  assert.equal(fake.notes.size, 1);
  assert.equal(fake.countCalls('addNote'), 1);
  assert.equal((await repository.getCapture(capture.captureId)).link.deliveryState, 'synced');
  repository.close();
});

test('an expired lease owner cannot persist intent or call addNote', async () => {
  let clock = 275;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('lease'), now: () => clock });
  await readyCapture(repository);
  const oldJob = await repository.claimDueJob('push', clock, 'old-worker', 5);
  clock += 6;
  const currentJob = await repository.claimDueJob('push', clock, 'current-worker', 5);
  const fake = new FakeAnki();
  const service = new SyncService({
    repository,
    ankiClient: fake,
    createOperationId: operationIds(),
    now: () => clock,
  });
  assert.equal((await service.processClaimedJob(oldJob)).status, 'stale');
  assert.equal(fake.countCalls('addNote'), 0);
  assert.equal((await service.processClaimedJob(currentJob)).status, 'committed');
  assert.equal(fake.countCalls('addNote'), 1);
  repository.close();
});

test('restart after remote success and before local confirmation queries first and never re-adds', async () => {
  const name = databaseName('restart');
  let clock = 300;
  let repository = await openAnkiRepository({ indexedDB, name, now: () => clock });
  const { capture } = await readyCapture(repository);
  const firstJob = await repository.claimDueJob('push', clock, 'dead-worker', 5);
  const intended = renderFields(capture);
  await repository.prepareWrite(capture.captureId, capture.contentRevision, intended, null, {
    opId: 'interrupted-create',
    kind: 'create',
    jobToken: { jobId: firstJob.jobId, ownerToken: firstJob.leaseOwner },
  });
  const fake = new FakeAnki();
  fake.seedNote({ fields: intended });
  repository.close();

  clock = 306;
  repository = await openAnkiRepository({ indexedDB, name, now: () => clock });
  const result = await runPush(repository, fake, clock, 'restarted-worker');
  assert.equal(result.status, 'committed');
  assert.equal(fake.countCalls('addNote'), 0);
  assert.equal(fake.calls[3].action, 'findNotes');
  assert.equal((await repository.getCapture(capture.captureId)).link.pendingWrite, null);
  repository.close();
});

test('a local confirmation failure leaves durable intent and the next attempt reconciles', async () => {
  let clock = 400;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('confirm-failure'), now: () => clock });
  const { capture } = await readyCapture(repository);
  const fake = new FakeAnki();
  const originalConfirm = repository.confirmWrite.bind(repository);
  let failConfirmation = true;
  repository.confirmWrite = async (...args) => {
    if (failConfirmation) {
      failConfirmation = false;
      throw new ContractError('STORAGE_FAILED', 'confirmation failed', { retryable: true });
    }
    return originalConfirm(...args);
  };
  const first = await runPush(repository, fake, clock, 'first-worker');
  assert.equal(first.status, 'retry_scheduled');
  assert.equal(fake.countCalls('addNote'), 1);
  assert.ok((await repository.getCapture(capture.captureId)).link.pendingWrite);

  clock += 5_000;
  const second = await runPush(repository, fake, clock, 'second-worker');
  assert.equal(second.status, 'committed');
  assert.equal(fake.countCalls('addNote'), 1);
  assert.equal((await repository.getCapture(capture.captureId)).link.pendingWrite, null);
  repository.close();
});

test('same term in different contexts creates distinct notes while duplicate identities conflict', async () => {
  const clock = 500;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('identity'), now: () => clock });
  const first = await readyCapture(repository, 'The iterator yields each record.');
  const second = await readyCapture(repository, 'This function yields control briefly.');
  assert.notEqual(first.capture.captureId, second.capture.captureId);
  const fake = new FakeAnki();
  assert.equal((await runPush(repository, fake, clock, 'first')).status, 'committed');
  assert.equal((await runPush(repository, fake, clock, 'second')).status, 'committed');
  assert.equal(fake.notes.size, 2);
  assert.equal(fake.countCalls('addNote'), 2);

  const third = await readyCapture(repository, 'A generator yields values lazily.');
  const duplicateFields = renderFields(third.capture);
  fake.seedNote({ fields: duplicateFields });
  fake.seedNote({ fields: duplicateFields });
  const conflict = await runPush(repository, fake, clock, 'duplicate-worker');
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.error.code, 'MULTIPLE_MATCHES');
  assert.equal(fake.countCalls('addNote'), 2);
  assert.equal((await repository.getCapture(third.capture.captureId)).link.deliveryState, 'conflict');
  repository.close();
});

test('linked notes that disappear become remote_missing and are never recreated', async () => {
  const clock = 600;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('missing'), now: () => clock });
  const { capture } = await readyCapture(repository);
  const intended = renderFields(capture);
  await repository.prepareWrite(capture.captureId, capture.contentRevision, intended, null, {
    opId: 'prior-create', kind: 'create',
  });
  await repository.confirmWrite('prior-create', intended, 999);
  const fake = new FakeAnki();
  const result = await runPush(repository, fake, clock);
  assert.equal(result.status, 'remote_missing');
  assert.equal(fake.countCalls('addNote'), 0);
  assert.equal((await repository.getCapture(capture.captureId)).link.deliveryState, 'remote_missing');
  repository.close();
});

test('suspicious search results and profile mismatch stop before addNote', async () => {
  const clock = 700;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('target-check'), now: () => clock });
  const first = await readyCapture(repository, 'The iterator yields each record.');
  const fake = new FakeAnki();
  const wrongFields = { ...renderFields(first.capture), CaptureId: `lk1_${'f'.repeat(64)}` };
  const wrongId = fake.seedNote({ fields: wrongFields });
  fake.findNotesByCaptureId = async captureId => {
    fake.calls.push({ action: 'findNotes', captureId });
    return [wrongId];
  };
  const identityConflict = await runPush(repository, fake, clock, 'identity-worker');
  assert.equal(identityConflict.status, 'conflict');
  assert.equal(identityConflict.error.code, 'IDENTITY_MISMATCH');
  assert.equal(fake.countCalls('addNote'), 0);

  const second = await readyCapture(repository, 'This function yields control briefly.');
  const mismatchedProfile = new FakeAnki({ profile: 'Other Profile' });
  const blocked = await runPush(repository, mismatchedProfile, clock, 'profile-worker');
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.error.code, 'PROFILE_MISMATCH');
  assert.equal(mismatchedProfile.countCalls('addNote'), 0);
  assert.equal((await repository.getCapture(second.capture.captureId)).link.deliveryState, 'blocked');
  repository.close();
});

test('captures without a valid meaning never have a push job', async () => {
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('blank'), now: () => 800 });
  await repository.createOrGetCapture(snapshot(), {
    destination: defaults().destination,
  });
  assert.equal(await repository.claimDueJob('push', 800, 'push-worker'), null);
  repository.close();
});
