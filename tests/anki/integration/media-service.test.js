'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { MediaService, MAX_MEDIA_BYTES, validateAudio } = require('../../../src/anki/media-service');
const { MediaStore } = require('../../../src/anki/media-store');
const { openAnkiRepository } = require('../../../src/anki/repository');
const { SyncService } = require('../../../src/anki/sync-service');
const { FakeAnki } = require('../support/fake-anki');

let sequence = 0;
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 1, 0]);

function snapshot(term = 'record') {
  const contextText = `Please pronounce this ${term}.`;
  const targetStart = contextText.indexOf(term);
  return {
    language: 'en', term, contextText, targetStart, targetEnd: targetStart + term.length,
    contextQuality: 'sentence', fallbackSourceKey: '',
    source: { kind: 'web', url: 'https://example.test/article', title: 'Article' },
  };
}

function defaults() {
  return {
    content: { meaning: 'a stored item' }, mediaState: 'pending',
    destination: { expectedProfile: 'User 1', deckName: 'LingKuma', modelName: 'LingKuma Lookup v1' },
  };
}

async function fixture(audioProvider) {
  let clock = 1_000;
  const repository = await openAnkiRepository({ indexedDB, name: `lingkuma-media-${++sequence}`, now: () => clock });
  const anki = new FakeAnki();
  const created = await repository.createOrGetCapture(snapshot(), defaults());
  const sync = new SyncService({ repository, ankiClient: anki, createOperationId: () => `op-${clock}`, now: () => clock });
  let job = await repository.claimDueJob('push', clock, 'text', 30_000);
  assert.equal((await sync.processClaimedJob(job)).status, 'committed');
  const store = new MediaStore(repository);
  const media = new MediaService({ repository, mediaStore: store, audioProvider, ankiClient: anki, now: () => clock });
  return {
    repository, anki, store, media, captureId: created.capture.captureId,
    async runMedia(owner = 'media') {
      job = await repository.claimDueJob('media', clock, owner, 30_000);
      return media.processClaimedJob(job);
    },
    async pushAudio(owner = 'audio-push') {
      job = await repository.claimDueJob('push', clock, owner, 30_000);
      return sync.processClaimedJob(job);
    },
    advance(ms) { clock += ms; },
  };
}

function provider({ key = 'voice-a', afterFetch } = {}) {
  return {
    async describe(capture) { return { inputKey: JSON.stringify([capture.content.term, 'en', key]) }; },
    async getWordAudio() {
      if (afterFetch) await afterFetch();
      return { bytes: mp3, mime: 'audio/mpeg' };
    },
  };
}

test('uploads content-addressed pronunciation then updates the same note through push', async () => {
  const f = await fixture(provider());
  assert.equal((await f.runMedia()).status, 'committed');
  let capture = await f.repository.getCapture(f.captureId);
  assert.equal(capture.mediaState, 'ready');
  assert.match(capture.ankiMediaFilename, /^lk_audio_[a-f0-9]{64}\.mp3$/);
  assert.deepEqual(capture.dirtyFields, ['Audio']);
  assert.equal(f.anki.countCalls('addNote'), 1);
  assert.equal(f.anki.countCalls('storeMediaFile'), 1);

  assert.equal((await f.pushAudio()).status, 'committed');
  capture = await f.repository.getCapture(f.captureId);
  const note = f.anki.notes.get(capture.link.noteIdHint);
  assert.equal(note.fields.Audio, `[sound:${capture.ankiMediaFilename}]`);
  assert.equal(f.anki.countCalls('addNote'), 1);
  assert.equal(f.anki.countCalls('updateNoteFields'), 1);
  f.repository.close();
});

test('unsupported playback-only provider leaves the already-synced text note intact', async () => {
  const f = await fixture({ describe: async () => null, getWordAudio: async () => assert.fail('must not fetch') });
  assert.equal((await f.runMedia()).status, 'unavailable');
  const capture = await f.repository.getCapture(f.captureId);
  assert.equal(capture.mediaState, 'unavailable');
  assert.equal(capture.link.deliveryState, 'synced');
  assert.equal(f.anki.countCalls('addNote'), 1);
  assert.equal(f.anki.countCalls('storeMediaFile'), 0);
  f.repository.close();
});

test('worker interruption after upload reuses persisted media and never creates another note', async () => {
  const f = await fixture(provider());
  const originalFinalize = f.store.finalize.bind(f.store);
  let interrupted = true;
  f.store.finalize = async (...args) => {
    if (interrupted) {
      interrupted = false;
      throw new Error('worker interrupted');
    }
    return originalFinalize(...args);
  };
  assert.equal((await f.runMedia('first')).status, 'rescheduled');
  assert.equal(f.anki.countCalls('storeMediaFile'), 1);
  f.advance(5_000);
  assert.equal((await f.runMedia('second')).status, 'committed');
  assert.equal(f.anki.countCalls('storeMediaFile'), 1);
  await f.pushAudio();
  assert.equal(f.anki.countCalls('addNote'), 1);
  f.repository.close();
});

test('changed voice input key prevents an old result from attaching', async () => {
  let key = 'voice-a';
  const audioProvider = {
    async describe(capture) { return { inputKey: JSON.stringify([capture.content.term, 'en', key]) }; },
    async getWordAudio() { key = 'voice-b'; return { bytes: mp3, mime: 'audio/mpeg' }; },
  };
  const f = await fixture(audioProvider);
  assert.equal((await f.runMedia()).status, 'stale_input');
  assert.equal((await f.repository.getCapture(f.captureId)).mediaState, 'pending');
  f.repository.close();
});

test('audio validation rejects HTML, MIME mismatches, empty and oversized responses', () => {
  assert.throws(() => validateAudio({ bytes: new TextEncoder().encode('<html>error</html>'), mime: 'audio/mpeg' }), /supported audio/);
  assert.throws(() => validateAudio({ bytes: mp3, mime: 'text/html' }), /supported audio/);
  assert.throws(() => validateAudio({ bytes: new Uint8Array(), mime: 'audio/mpeg' }), /supported audio/);
  assert.throws(() => validateAudio({ bytes: new Uint8Array(MAX_MEDIA_BYTES + 1), mime: 'audio/mpeg' }), /supported audio/);
});
