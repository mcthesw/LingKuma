'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { CaptureService } = require('../../../src/anki/capture-service');
const { openAnkiRepository } = require('../../../src/anki/repository');

let sequence = 0;
function snapshot(sentence = 'The iterator yields each record.') {
  const term = 'yields';
  const start = sentence.indexOf(term);
  return {
    language: 'en',
    term,
    contextText: sentence,
    targetStart: start,
    targetEnd: start + term.length,
    contextQuality: 'sentence',
    fallbackSourceKey: '',
    source: { kind: 'web', url: 'https://example.test/article', title: 'Article' },
  };
}

async function fixture(defaults = {}, policy = {}) {
  sequence += 1;
  let now = sequence * 1_000;
  const repository = await openAnkiRepository({
    indexedDB,
    name: `capture-service-${sequence}`,
    now: () => ++now,
  });
  const drains = [];
  const notifications = [];
  const service = new CaptureService({
    repository,
    getLookupPolicy: async () => ({
      enabled: true,
      learningLanguage: null,
      defaults,
      ...policy,
    }),
    scheduleDrain: captureId => { drains.push(captureId); },
    notifyCaptureChanged: dto => { notifications.push(dto); },
  });
  return { repository, service, drains, notifications };
}

test('lookup persists before responding and does not require Anki setup', async () => {
  const { repository, service, drains } = await fixture();
  const result = await service.lookup({ lookupSessionId: 'lookup-1', originSnapshot: snapshot() });
  assert.equal(result.persisted, true);
  assert.equal(result.existing, false);
  assert.equal(result.capture.status, 'waiting_content');
  assert.equal(Object.prototype.hasOwnProperty.call(result.capture, 'destination'), false);
  assert.equal((await repository.getCapture(result.captureId)).captureId, result.captureId);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(drains, [result.captureId]);
  repository.close();
});

test('repeat lookup reopens one record while a new context creates another automatically', async () => {
  const { repository, service } = await fixture();
  const first = await service.lookup({ lookupSessionId: 'lookup-a', originSnapshot: snapshot() });
  const repeated = await service.lookup({ lookupSessionId: 'lookup-b', originSnapshot: snapshot() });
  const other = await service.lookup({
    lookupSessionId: 'lookup-c',
    originSnapshot: snapshot('This process yields useful information.'),
  });

  assert.equal(repeated.existing, true);
  assert.equal(repeated.captureId, first.captureId);
  assert.equal(repeated.capture.createdAt, first.capture.createdAt);
  assert.equal(other.existing, false);
  assert.notEqual(other.captureId, first.captureId);
  assert.equal((await repository.listCaptures()).items.length, 2);

  const claimed = await repository.claimDueJob('enrich', 100_000, 'worker-1');
  const next = await repository.claimDueJob('enrich', 100_000, 'worker-2');
  const third = await repository.claimDueJob('enrich', 100_000, 'worker-3');
  assert.notEqual(claimed.captureId, next.captureId);
  assert.equal(third, null);
  repository.close();
});

test('conflict, remote-missing and excluded captures reopen instead of bypassing identity', async () => {
  for (const state of ['conflict', 'remote_missing', 'excluded']) {
    const { repository, service } = await fixture();
    const first = await service.lookup({ lookupSessionId: `first-${state}`, originSnapshot: snapshot() });
    if (state === 'excluded') {
      await service.exclude(first.captureId);
    } else {
      await repository.setDeliveryState(first.captureId, state, { code: state.toUpperCase(), retryable: false });
    }

    const repeated = await service.lookup({ lookupSessionId: `again-${state}`, originSnapshot: snapshot() });
    assert.equal(repeated.existing, true);
    assert.equal(repeated.captureId, first.captureId);
    assert.equal(repeated.capture.status, state);
    assert.equal((await repository.listCaptures()).items.length, 1);
    repository.close();
  }
});

test('pause blocks only new captures while existing work remains addressable', async () => {
  const active = await fixture({}, { learningLanguage: 'fr' });
  const first = await active.service.lookup({
    lookupSessionId: 'before-pause',
    originSnapshot: snapshot(),
  });
  active.repository.close();

  const repository = await openAnkiRepository({
    indexedDB,
    name: `capture-service-${sequence}`,
    now: () => 50_000,
  });
  const service = new CaptureService({
    repository,
    getLookupPolicy: async () => ({
      enabled: false,
      learningLanguage: 'fr',
      defaults: {},
    }),
  });
  const existing = await service.lookup({
    lookupSessionId: 'paused-existing',
    originSnapshot: { ...snapshot(), language: 'de' },
  });
  const absent = await service.lookup({
    lookupSessionId: 'paused-new',
    originSnapshot: snapshot('This process yields useful information.'),
  });

  assert.equal(existing.captureId, first.captureId);
  assert.equal(existing.persisted, true);
  assert.equal(existing.paused, true);
  assert.equal(absent.captureId, null);
  assert.equal(absent.persisted, false);
  assert.equal(absent.paused, true);
  assert.equal((await repository.listCaptures()).items.length, 1);
  repository.close();
});

test('edit, regenerate, exclude and resume preserve identity and enforce revisions', async () => {
  const { repository, service, notifications } = await fixture();
  const first = await service.lookup({ lookupSessionId: 'first', originSnapshot: snapshot() });
  const edited = await service.edit({
    captureId: first.captureId,
    expectedRevision: 0,
    patch: { meaning: '产生', userNote: 'manual' },
  });
  assert.equal(edited.contentRevision, 1);
  assert.equal(edited.content.meaning, '产生');
  await assert.rejects(
    service.edit({ captureId: first.captureId, expectedRevision: 0, patch: { userNote: 'stale' } }),
    error => error.code === 'STALE_REVISION',
  );

  const regenerated = await service.regenerate({ captureId: first.captureId, expectedRevision: 1 });
  assert.equal(regenerated.contentState, 'pending');
  assert.equal(regenerated.content.meaning, '产生');
  const excluded = await service.exclude(first.captureId);
  assert.equal(excluded.status, 'excluded');
  await assert.rejects(
    service.regenerate({ captureId: first.captureId, expectedRevision: 1 }),
    error => error.code === 'INPUT_INVALID',
  );
  const resumed = await service.resume(first.captureId);
  assert.equal(resumed.active, true);
  assert.equal(resumed.captureId, first.captureId);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(notifications.at(-1).captureId, first.captureId);
  repository.close();
});

test('public DTO omits note hints, write intents and remote field bodies', async () => {
  const { repository, service } = await fixture();
  const first = await service.lookup({ lookupSessionId: 'first', originSnapshot: snapshot() });
  await repository.prepareWrite(first.captureId, 0, { Meaning: 'x' }, null, { opId: 'secret-op', kind: 'create' });
  await repository.recordRemoteDifference(first.captureId, { Meaning: '<b>remote</b>' });
  const dto = await service.get(first.captureId);
  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes('secret-op'), false);
  assert.equal(serialized.includes('<b>remote</b>'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(dto.link, 'noteIdHint'), false);
  repository.close();
});
