'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { AnkiConnectClient } = require('../../../src/anki/anki-client');
const { AssociationStore } = require('../../../src/anki/association-store');
const { BackupService } = require('../../../src/anki/backup-service');
const { BackupStore } = require('../../../src/anki/backup-store');
const { CaptureService } = require('../../../src/anki/capture-service');
const { ContractError } = require('../../../src/anki/contracts');
const { EnrichmentCoordinator } = require('../../../src/anki/enrichment');
const { ManagementService } = require('../../../src/anki/management-service');
const { ManagementStore } = require('../../../src/anki/management-store');
const { ReconciliationService } = require('../../../src/anki/reconciliation-service');
const { openAnkiRepository } = require('../../../src/anki/repository');
const { AnkiSettingsService, SettingsBackedAnkiClient } = require('../../../src/anki/setup-service');
const { SyncService } = require('../../../src/anki/sync-service');

const RUN_REAL = process.env.ANKI_REAL_E2E === '1';
const ENDPOINT = process.env.ANKI_CONNECT_ENDPOINT || 'http://127.0.0.1:8765/';
const API_KEY = process.env.ANKI_CONNECT_KEY || '';
const TEST_DECK = process.env.ANKI_TEST_DECK || 'LingKuma Phase1 Acceptance';

async function invoke(action, params = {}) {
  const payload = { action, version: 6, params };
  if (API_KEY) payload.key = API_KEY;
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.ok, true, `${action} returned HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(body.error, null, `${action}: ${body.error}`);
  return body.result;
}

function snapshot(runId) {
  const term = `acceptance-${runId}`;
  const contextText = `The isolated LingKuma acceptance flow records ${term} exactly once.`;
  const targetStart = contextText.indexOf(term);
  return {
    language: 'en',
    term,
    contextText,
    targetStart,
    targetEnd: targetStart + term.length,
    contextQuality: 'sentence',
    fallbackSourceKey: '',
    source: { kind: 'web', url: `https://example.test/acceptance/${runId}`, title: 'LingKuma acceptance' },
  };
}

async function processPush(repository, service, at, ownerToken) {
  const job = await repository.claimDueJob('push', at, ownerToken, 30_000);
  assert.ok(job, `expected a push job for ${ownerToken}`);
  return service.processClaimedJob(job);
}

function reviewState(card) {
  return Object.fromEntries([
    'cardId', 'note', 'deckName', 'modelName', 'queue', 'due', 'interval', 'reps', 'lapses', 'left', 'factor',
  ].map(key => [key, card[key]]));
}

test('A49 real setup, capture, Anki recovery, conflict resolution, and backup', {
  skip: !RUN_REAL && 'set ANKI_REAL_E2E=1 and use a dedicated local Anki profile/deck',
  timeout: 60_000,
}, async () => {
  const runId = `${Date.now()}-${process.pid}`;
  let captureId = null;
  let repository;
  const actions = [];
  let offline = false;
  let providerCalls = 0;
  let clock = Date.now();

  const trackedFetch = async (url, init) => {
    const request = JSON.parse(init.body);
    actions.push(request.action);
    if (offline) throw new TypeError('fault injection: Anki offline');
    return fetch(url, init);
  };

  try {
    await invoke('createDeck', { deck: TEST_DECK });
    repository = await openAnkiRepository({
      indexedDB,
      name: `lingkuma-real-acceptance-${runId}`,
      now: () => clock,
    });
    const settingsService = new AnkiSettingsService({
      repository,
      clientFactory: options => new AnkiConnectClient({ ...options, fetchImpl: trackedFetch, readRetries: 0 }),
    });
    await settingsService.save({
      endpoint: ENDPOINT,
      apiKey: API_KEY,
      deckName: TEST_DECK,
      learningLanguage: 'en',
      meaningLanguage: 'zh',
      autoCaptureEnabled: true,
      attachAudio: false,
    });

    const ankiClient = new SettingsBackedAnkiClient({ settingsService });
    const captureService = new CaptureService({
      repository,
      getLookupPolicy: () => settingsService.getLookupPolicy(),
    });
    const syncService = new SyncService({ repository, ankiClient, now: () => clock });
    const reconciliationService = new ReconciliationService({
      repository,
      associationStore: new AssociationStore(repository),
      ankiClient,
      now: () => clock,
    });
    const managementService = new ManagementService({
      repository,
      managementStore: new ManagementStore(repository),
      captureService,
      syncService,
      reconciliationService,
      ankiClient,
    });
    const backupService = new BackupService({ backupStore: new BackupStore(repository), now: () => clock });
    const enrichment = new EnrichmentCoordinator({
      repository,
      provider: {
        async explainInContext() {
          providerCalls += 1;
          return {
            meaning: '用于真实验收的隔离记录',
            sentenceTranslation: '隔离的 LingKuma 验收流程只记录一次。',
            reading: '',
            usage: 'acceptance only',
          };
        },
      },
      getMeaningLanguage: async () => 'zh',
      now: () => clock,
    });

    const lookup = await captureService.lookup({ lookupSessionId: `real-${runId}`, originSnapshot: snapshot(runId) });
    captureId = lookup.captureId;
    assert.equal(lookup.persisted, true);
    assert.equal((await enrichment.processNext({ ownerToken: 'real-enrich', at: clock })).status, 'committed');
    assert.equal((await processPush(repository, syncService, clock, 'real-create')).status, 'committed');

    let capture = await repository.getCapture(captureId);
    assert.equal(capture.link.deliveryState, 'synced');
    const noteId = capture.link.noteIdHint;
    const noteInfo = await invoke('notesInfo', { notes: [noteId] });
    assert.equal(noteInfo[0].fields.CaptureId.value, captureId);
    const cardId = noteInfo[0].cards[0];
    const beforeCard = reviewState((await invoke('cardsInfo', { cards: [cardId] }))[0]);

    await managementService.edit({
      captureId,
      expectedRevision: capture.contentRevision,
      patch: { userNote: 'saved while testing offline recovery' },
    });
    offline = true;
    const offlineResult = await processPush(repository, syncService, clock, 'real-offline');
    assert.equal(offlineResult.status, 'retry_scheduled');
    const queuedOffline = await repository.getCapture(captureId);
    assert.equal(queuedOffline.link.deliveryState, 'synced');
    assert.deepEqual(queuedOffline.dirtyFields, ['UserNote']);
    offline = false;
    clock += 5_000;
    assert.equal((await processPush(repository, syncService, clock, 'real-recovered')).status, 'committed');

    capture = await repository.getCapture(captureId);
    await managementService.edit({
      captureId,
      expectedRevision: capture.contentRevision,
      patch: { userNote: 'keep this local choice' },
    });
    await invoke('updateNoteFields', { note: { id: noteId, fields: { Meaning: 'external Anki edit' } } });
    const inspected = await managementService.inspect({ captureId });
    assert.equal(inspected.status, 'conflict');
    assert.equal(inspected.remoteFields.Meaning, 'external Anki edit');

    await managementService.resolve({
      captureId,
      expectedRevision: inspected.contentRevision,
      strategy: 'fields',
      localFields: ['UserNote'],
    });
    assert.equal((await processPush(repository, syncService, clock, 'real-conflict-resolution')).status, 'committed');

    const finalNote = (await invoke('notesInfo', { notes: [noteId] }))[0];
    assert.equal(finalNote.fields.Meaning.value, 'external Anki edit');
    assert.equal(finalNote.fields.UserNote.value, 'keep this local choice');
    assert.equal(finalNote.cards[0], cardId);
    const afterCard = reviewState((await invoke('cardsInfo', { cards: [cardId] }))[0]);
    assert.deepEqual(afterCard, beforeCard);

    const backup = await backupService.export();
    assert.equal(backup.captures.length, 1);
    assert.equal(backup.captures[0].captureId, captureId);
    const serialized = JSON.stringify(backup);
    assert.equal(serialized.includes(API_KEY || '__no_key__'), false);
    assert.equal(serialized.includes('pendingWrite'), false);
    assert.equal(providerCalls, 1);
    assert.equal(actions.filter(action => action === 'addNote').length, 1);
    assert.equal(actions.some(action => ['guiAddCards', 'sync', 'loadProfile', 'changeDeck', 'setDueDate'].includes(action)), false);
  } finally {
    offline = false;
    if (captureId) {
      const noteIds = await invoke('findNotes', { query: `CaptureId:${captureId}` }).catch(() => []);
      if (noteIds.length) await invoke('deleteNotes', { notes: noteIds });
    }
    repository?.close();
  }
});
