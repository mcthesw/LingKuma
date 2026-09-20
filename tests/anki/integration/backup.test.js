'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { AssociationStore } = require('../../../src/anki/association-store');
const { BackupService } = require('../../../src/anki/backup-service');
const { BackupStore } = require('../../../src/anki/backup-store');
const { MediaService } = require('../../../src/anki/media-service');
const { MediaStore } = require('../../../src/anki/media-store');
const { sha256 } = require('../../../src/anki/media-service');
const { ReconciliationService } = require('../../../src/anki/reconciliation-service');
const { openAnkiRepository } = require('../../../src/anki/repository');
const { SyncService } = require('../../../src/anki/sync-service');
const { FakeAnki } = require('../support/fake-anki');

let sequence = 0;
const destination = { expectedProfile: 'User 1', deckName: 'LingKuma', modelName: 'LingKuma Lookup v1' };
function snapshot() {
  const contextText = 'The iterator yields each record.';
  const term = 'yields';
  const targetStart = contextText.indexOf(term);
  return {
    language: 'en', term, contextText, targetStart, targetEnd: targetStart + term.length,
    contextQuality: 'sentence', fallbackSourceKey: '',
    source: { kind: 'web', url: 'https://example.test/article', title: 'Article' },
  };
}
async function repository(label, now = () => 1_000) {
  return openAnkiRepository({ indexedDB, name: `lingkuma-backup-${label}-${++sequence}`, now });
}
async function linkedCapture(repo, anki, now = 1_000) {
  const { capture } = await repo.createOrGetCapture(snapshot(), { content: { meaning: '产生' }, destination });
  const job = await repo.claimDueJob('push', now, 'push');
  const service = new SyncService({ repository: repo, ankiClient: anki, createOperationId: () => 'backup-create', now: () => now });
  assert.equal((await service.processClaimedJob(job)).status, 'committed');
  return repo.getCapture(capture.captureId);
}

test('A44 export excludes credentials, leases, and pending writes; validated restore remains readable and unverified', async () => {
  const source = await repository('export');
  const anki = new FakeAnki();
  let capture = await linkedCapture(source, anki);
  await source.patchContent(capture.captureId, capture.contentRevision, { userNote: 'not yet confirmed' });
  const push = await source.claimDueJob('push', 2_000, 'active-lease');
  capture = await source.getCapture(capture.captureId);
  await source.prepareWrite(capture.captureId, capture.contentRevision, { ...capture.link.baseFields, UserNote: 'not yet confirmed' }, capture.link.baseFields, {
    opId: 'unconfirmed-write', kind: 'update', jobToken: { jobId: push.jobId, ownerToken: push.leaseOwner }, submittedFields: ['UserNote'],
  });
  await source.setMeta('ankiConnectionSettingsV1', { key: 'top-secret', endpoint: 'http://127.0.0.1:8765' });

  const service = new BackupService({ backupStore: new BackupStore(source), now: () => 3_000 });
  const backup = await service.export();
  const serialized = JSON.stringify(backup);
  assert.equal(serialized.includes('top-secret'), false);
  assert.equal(serialized.includes('pendingWrite'), false);
  assert.equal(serialized.includes('leaseOwner'), false);
  assert.equal(serialized.includes('unconfirmed-write'), false);

  const target = await repository('restore');
  const result = await new BackupService({ backupStore: new BackupStore(target) }).import({ backup });
  assert.deepEqual(result, { restored: 1, duplicate: 0, conflict: 0, rejected: 0, mediaRestored: 0 });
  const restored = await target.getCapture(capture.captureId);
  assert.equal(restored.content.userNote, 'not yet confirmed');
  assert.equal(restored.link.noteIdHint, null);
  assert.equal(restored.link.pendingWrite, null);
  assert.equal(restored.link.lastVerifiedAt, null);
  assert.equal(restored.link.deliveryState, 'pending');
  const restoredAnki = new FakeAnki();
  restoredAnki.seedNote({ fields: restored.link.baseFields });
  const inspectJob = await target.claimDueJob('inspect', Date.now(), 'inspect');
  const reconciliation = new ReconciliationService({
    repository: target,
    associationStore: new AssociationStore(target),
    ankiClient: restoredAnki,
  });
  assert.equal((await reconciliation.processClaimedJob(inspectJob)).status, 'committed');
  assert.equal((await target.getCapture(capture.captureId)).link.deliveryState, 'conflict');
  assert.equal(restoredAnki.countCalls('updateNoteFields'), 0);
  source.close();
  target.close();
});

test('optional media is integrity-checked, restored locally, and never trusts an old Anki filename', async () => {
  const source = await repository('media');
  const anki = new FakeAnki();
  const capture = await linkedCapture(source, anki);
  const bytes = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69]);
  const hash = await sha256(bytes);
  await new MediaStore(source).put({ hash, mime: 'audio/wav', bytes, filename: `lk_audio_${hash}.wav`, ankiMediaFilename: 'old-name.wav' });
  const transaction = source.database.transaction('captures', 'readwrite');
  const request = transaction.objectStore('captures').get(capture.captureId);
  const stored = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  stored.mediaState = 'ready';
  stored.mediaHash = hash;
  stored.ankiMediaFilename = 'old-name.wav';
  transaction.objectStore('captures').put(stored);
  await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });

  const backup = await new BackupService({ backupStore: new BackupStore(source) }).export({ includeMedia: true });
  assert.equal(backup.media.length, 1);
  assert.equal(JSON.stringify(backup).includes('old-name.wav'), false);
  const target = await repository('media-restore');
  const result = await new BackupService({ backupStore: new BackupStore(target) }).import({ backup });
  assert.equal(result.mediaRestored, 1);
  const restoredMedia = await new MediaStore(target).get(hash);
  assert.deepEqual([...restoredMedia.bytes], [...bytes]);
  assert.equal(restoredMedia.ankiMediaFilename, null);
  assert.equal((await target.getCapture(capture.captureId)).mediaState, 'pending');
  const targetAnki = new FakeAnki();
  const restoredCapture = await target.getCapture(capture.captureId);
  targetAnki.seedNote({ fields: restoredCapture.link.baseFields });
  const associationStore = new AssociationStore(target);
  const reconciliation = new ReconciliationService({ repository: target, associationStore, ankiClient: targetAnki });
  const inspectJob = await target.claimDueJob('inspect', Date.now(), 'media-inspect');
  assert.equal((await reconciliation.processClaimedJob(inspectJob)).status, 'committed');
  const mediaJob = await target.claimDueJob('media', Date.now(), 'media-restore');
  const mediaService = new MediaService({
    repository: target,
    mediaStore: new MediaStore(target),
    audioProvider: { describe: async () => { throw new Error('provider must not be called'); } },
    ankiClient: targetAnki,
  });
  assert.equal((await mediaService.processClaimedJob(mediaJob)).status, 'committed');
  assert.equal(targetAnki.countCalls('storeMediaFile'), 1);
  source.close();
  target.close();
});

test('A45 older backup neither overwrites newer local content nor recreates a deleted Anki note', async () => {
  const source = await repository('old');
  const sourceAnki = new FakeAnki();
  const oldCapture = await linkedCapture(source, sourceAnki);
  const backup = await new BackupService({ backupStore: new BackupStore(source) }).export();

  const existing = await repository('newer');
  const { capture } = await existing.createOrGetCapture(snapshot(), { content: { meaning: 'newer local meaning' }, destination });
  await existing.patchContent(capture.captureId, capture.contentRevision, { userNote: 'newer local note' });
  const counts = await new BackupService({ backupStore: new BackupStore(existing) }).import({ backup });
  assert.deepEqual(counts, { restored: 0, duplicate: 0, conflict: 1, rejected: 0, mediaRestored: 0 });
  const unchanged = await existing.getCapture(capture.captureId);
  assert.equal(unchanged.content.meaning, 'newer local meaning');
  assert.equal(unchanged.content.userNote, 'newer local note');

  const restored = await repository('deleted-remote');
  await new BackupService({ backupStore: new BackupStore(restored) }).import({ backup });
  const associationStore = new AssociationStore(restored);
  const reconciliation = new ReconciliationService({ repository: restored, associationStore, ankiClient: new FakeAnki() });
  const job = await restored.claimDueJob('inspect', Date.now(), 'inspect-deleted');
  const inspected = await reconciliation.processClaimedJob(job);
  assert.equal(inspected.status, 'remote_missing');
  assert.equal((await restored.getCapture(oldCapture.captureId)).link.deliveryState, 'remote_missing');
  assert.equal(reconciliation.ankiClient.countCalls('addNote'), 0);
  source.close();
  existing.close();
  restored.close();
});

test('A46 malformed, oversized, and identity-tampered backups are rejected before the database changes', async () => {
  const source = await repository('valid');
  await source.createOrGetCapture(snapshot(), { content: { meaning: 'meaning' }, destination });
  const backup = await new BackupService({ backupStore: new BackupStore(source) }).export();
  const target = await repository('reject');
  const service = new BackupService({ backupStore: new BackupStore(target) });

  await assert.rejects(() => service.import({ backup: { ...backup, schemaVersion: 99 } }), error => error.code === 'INPUT_INVALID');
  const tampered = structuredClone(backup);
  tampered.captures[0].captureId = `lk1_${'f'.repeat(64)}`;
  await assert.rejects(() => service.import({ backup: tampered }), error => error.code === 'IDENTITY_MISMATCH');
  const oversized = { ...backup, extra: 'x'.repeat(17 * 1024 * 1024) };
  await assert.rejects(() => service.import({ backup: oversized }), error => error.code === 'INPUT_INVALID');
  assert.equal((await target.listCaptures({ limit: 100 })).items.length, 0);
  source.close();
  target.close();
});
