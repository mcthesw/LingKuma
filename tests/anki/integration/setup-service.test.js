'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { ContractError } = require('../../../src/anki/contracts');
const { ANKI_FIELD_NAMES } = require('../../../src/anki/contracts');
const { MODEL_NAME } = require('../../../src/anki/note-model');
const { openAnkiRepository } = require('../../../src/anki/repository');
const {
  AnkiSettingsService,
  SETTINGS_META_KEY,
  SettingsBackedAnkiClient,
} = require('../../../src/anki/setup-service');

let sequence = 0;
function databaseName(label) {
  sequence += 1;
  return `lingkuma-anki-setup-${label}-${sequence}`;
}

function snapshot(term = 'yields') {
  const contextText = `The iterator ${term} each record.`;
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

class SetupAnki {
  constructor({ profileSupported = true, deckNames = ['Deck A', 'Deck B'], fields = ANKI_FIELD_NAMES } = {}) {
    this.profileSupported = profileSupported;
    this.decks = deckNames;
    this.fields = fields;
    this.models = [];
    this.calls = [];
  }

  async version() { this.calls.push('version'); return 6; }
  async deckNames() { this.calls.push('deckNames'); return [...this.decks]; }
  async getProfileStatus(expectedProfile) {
    this.calls.push('getActiveProfile');
    if (!this.profileSupported) {
      return { supported: false, activeProfile: null, warning: 'Profile switching cannot be detected.' };
    }
    if (expectedProfile && expectedProfile !== 'Profile A') {
      throw new ContractError('PROFILE_MISMATCH', 'The active profile differs from setup.');
    }
    return { supported: true, activeProfile: 'Profile A', matches: expectedProfile ? true : null };
  }
  async modelNames() { this.calls.push('modelNames'); return [...this.models]; }
  async createModel(definition) { this.calls.push('createModel'); this.models.push(definition.modelName); return definition.modelName; }
  async modelFieldNames() { this.calls.push('modelFieldNames'); return [...this.fields]; }
}

function setup(repository, fake, clientOptions = []) {
  return new AnkiSettingsService({
    repository,
    clientFactory(options) {
      clientOptions.push({ ...options });
      fake.endpoint = options.endpoint;
      return fake;
    },
  });
}

function completeSettings(overrides = {}) {
  return {
    endpoint: 'http://127.0.0.1:8765/',
    apiKey: 'private-test-key',
    deckName: 'Deck A',
    learningLanguage: 'en',
    meaningLanguage: 'zh',
    autoCaptureEnabled: true,
    attachAudio: true,
    ...overrides,
  };
}

test('one setup binds pending captures, creates the fixed model, and never returns the key', async () => {
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('resume'), now: () => 100 });
  const pending = await repository.createOrGetCapture(snapshot());
  assert.equal(pending.capture.destination, undefined);
  const fake = new SetupAnki();
  const service = setup(repository, fake);

  const result = await service.save(completeSettings());
  assert.equal(result.configured, true);
  assert.equal(result.hasApiKey, true);
  assert.equal(result.expectedProfile, 'Profile A');
  assert.equal(JSON.stringify(result).includes('private-test-key'), false);
  assert.deepEqual(fake.models, [MODEL_NAME]);

  const rebound = await repository.getCapture(pending.capture.captureId);
  assert.deepEqual(rebound.destination, {
    deckName: 'Deck A',
    modelName: MODEL_NAME,
    expectedProfile: 'Profile A',
  });
  assert.equal((await repository.getJobSchedule()).count, 1);
  assert.equal((await repository.getMeta(SETTINGS_META_KEY)).apiKey, 'private-test-key');
  repository.close();
});

test('destination changes affect only new captures and pause changes do not reconnect', async () => {
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('destination'), now: () => 200 });
  const fake = new SetupAnki();
  const service = setup(repository, fake);
  await service.save(completeSettings());
  const oldCapture = await repository.createOrGetCapture(snapshot('yields'), await service.getCaptureDefaults());

  await service.save(completeSettings({ apiKey: undefined, deckName: 'Deck B' }));
  const updatedOld = await repository.getCapture(oldCapture.capture.captureId);
  assert.equal(updatedOld.destination.deckName, 'Deck A');
  const newer = await repository.createOrGetCapture(snapshot('returns'), await service.getCaptureDefaults());
  assert.equal(newer.capture.destination.deckName, 'Deck B');

  const callsBeforePause = fake.calls.length;
  const paused = await service.save({ autoCaptureEnabled: false });
  assert.equal(paused.autoCaptureEnabled, false);
  assert.equal(fake.calls.length, callsBeforePause);
  repository.close();
});

test('setup reports missing decks, incompatible models, profile limits, and later profile mismatch', async () => {
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('readiness') });
  const missingDeck = setup(repository, new SetupAnki({ deckNames: ['Other'] }));
  await assert.rejects(missingDeck.save(completeSettings()), error => error.code === 'DECK_MISSING');

  const incompatible = setup(repository, new SetupAnki({ fields: ['CaptureId', 'Term'] }));
  incompatible.clientFactory({}).models.push(MODEL_NAME);
  await assert.rejects(incompatible.save(completeSettings()), error => error.code === 'MODEL_INCOMPATIBLE');

  const noProfile = setup(repository, new SetupAnki({ profileSupported: false }));
  await assert.rejects(noProfile.save(completeSettings()), error => error.code === 'API_UNSUPPORTED');
  const accepted = await noProfile.save(completeSettings({ confirmSingleProfile: true }));
  assert.equal(accepted.profileDetectionSupported, false);
  assert.match(accepted.profileWarning, /cannot be detected/i);

  const privateSettings = await repository.getMeta(SETTINGS_META_KEY);
  privateSettings.expectedProfile = 'Different Profile';
  privateSettings.profileDetectionSupported = true;
  await repository.setMeta(SETTINGS_META_KEY, privateSettings);
  const backed = new SettingsBackedAnkiClient({ settingsService: noProfile });
  noProfile.clientFactory = () => new SetupAnki({ profileSupported: true });
  await assert.rejects(backed.getProfileStatus('Different Profile'), error => error.code === 'PROFILE_MISMATCH');
  repository.close();
});
