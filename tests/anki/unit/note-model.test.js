'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ANKI_FIELD_NAMES } = require('../../../src/anki/contracts');
const {
  CARD_TEMPLATES,
  MODEL_CSS,
  MODEL_NAME,
  assertCompatibleModelFields,
  assertDeckExists,
  buildAnkiNote,
  createModelDefinition,
  ensureNoteModel,
  renderFields,
} = require('../../../src/anki/note-model');

const captureId = `lk1_${'a'.repeat(64)}`;
function capture(overrides = {}) {
  const content = {
    term: 'bank',
    contextText: 'A bank is near another bank.',
    targetStart: 2,
    targetEnd: 6,
    meaning: '银行',
    sentenceTranslation: '',
    reading: '',
    usage: '',
    userNote: '',
    source: { kind: 'web', url: 'https://example.test/a?q=1', title: 'Example', locator: 'section 2' },
    ...(overrides.content || {}),
  };
  return {
    captureId,
    originSnapshot: { language: 'en' },
    createdAt: 0,
    content,
    mediaState: 'disabled',
    ...overrides,
    content,
  };
}

test('default model has twelve ordered fields and exactly one non-cloze card', () => {
  const model = createModelDefinition();
  assert.equal(model.modelName, MODEL_NAME);
  assert.deepEqual(model.inOrderFields, ANKI_FIELD_NAMES);
  assert.equal(model.inOrderFields[0], 'CaptureId');
  assert.equal(model.inOrderFields.length, 12);
  assert.equal(model.isCloze, false);
  assert.equal(model.cardTemplates.length, 1);
  assert.deepEqual(model.cardTemplates, CARD_TEMPLATES);
  assert.match(model.cardTemplates[0].Front, /{{Term}}/);
  assert.match(model.cardTemplates[0].Front, /{{Context}}/);
  assert.match(model.cardTemplates[0].Back, /{{Meaning}}/);
  assert.match(model.cardTemplates[0].Back, /{{FrontSide}}/);
  assert.doesNotMatch(model.cardTemplates[0].Front + model.cardTemplates[0].Back, /{{c\d+::|<script|https?:\/\//i);
  assert.doesNotMatch(MODEL_CSS, /@import|url\s*\(/i);
});

test('renderer emphasizes only the selected repeated occurrence', () => {
  const fields = renderFields(capture());
  assert.equal(fields.Context, 'A <strong class="lk-target">bank</strong> is near another bank.');
  assert.equal((fields.Context.match(/lk-target/g) || []).length, 1);
  assert.equal(fields.Term, 'bank');
  assert.equal(fields.Meaning, '银行');
  assert.equal(fields.Audio, '');
  assert.equal(fields.CapturedAt, '1970-01-01T00:00:00.000Z');
});

test('untrusted HTML, media directives, LaTeX and source URLs remain inert text', () => {
  const term = '<img src=x onerror=alert(1)>[sound:evil.mp3]\\(x\\)';
  const fields = renderFields(capture({
    content: {
      term,
      contextText: `before ${term} after ${term}`,
      targetStart: 7,
      targetEnd: 7 + term.length,
      meaning: '<script>alert(1)</script>[sound:remote.mp3]',
      userNote: '" onclick="alert(1)',
      source: { kind: 'web', url: 'javascript:alert(1)', title: '<b>unsafe</b>', locator: '[sound:x]' },
    },
  }));

  assert.doesNotMatch(fields.Term, /<img|\[sound:|\\\(/);
  assert.match(fields.Term, /&lt;img/);
  assert.match(fields.Term, /&#91;sound:evil\.mp3&#93;/);
  assert.doesNotMatch(fields.Meaning, /<script|\[sound:/);
  assert.equal(fields.Source.includes('<a '), false);
  assert.match(fields.Source, /&lt;b&gt;unsafe&lt;\/b&gt;/);
  assert.doesNotMatch(fields.Source, /javascript:|\[sound:/);
  assert.equal((fields.Context.match(/lk-target/g) || []).length, 1);
});

test('Audio is generated only from a complete allowlisted Anki media filename', () => {
  assert.equal(renderFields(capture({ ankiMediaFilename: 'lk_audio_abcd.mp3' })).Audio, '[sound:lk_audio_abcd.mp3]');
  assert.equal(renderFields(capture({ ankiMediaFilename: '../evil.mp3' })).Audio, '');
  assert.equal(renderFields(capture({ ankiMediaFilename: 'evil.mp3]{{Term}}' })).Audio, '');
});

test('long text is escaped without silent truncation', () => {
  const prefix = '<'.repeat(4000);
  const fields = renderFields(capture({
    content: {
      term: 'bank',
      contextText: `${prefix}bank`,
      targetStart: prefix.length,
      targetEnd: prefix.length + 4,
    },
  }));
  assert.equal((fields.Context.match(/&lt;/g) || []).length, 4000);
  assert.match(fields.Context, /<strong class="lk-target">bank<\/strong>$/);
});

test('model ensure reuses compatible models and never overwrites user templates or CSS', async () => {
  let createCalls = 0;
  const existingClient = {
    async modelNames() { return [MODEL_NAME]; },
    async modelFieldNames() { return [...ANKI_FIELD_NAMES]; },
    async createModel() { createCalls += 1; },
  };
  assert.deepEqual(await ensureNoteModel(existingClient), { modelName: MODEL_NAME, created: false });
  assert.equal(createCalls, 0);

  const build = buildAnkiNote(capture(), { deckName: 'Study' });
  assert.equal(build.deckName, 'Study');
  assert.equal(build.modelName, MODEL_NAME);
  assert.deepEqual(build.options, { allowDuplicate: false });
  assert.deepEqual(build.tags, ['lingkuma::lookup']);
  assert.equal(Object.prototype.hasOwnProperty.call(build, 'css'), false);
});

test('explicit setup creates a missing model once and verifies fields afterward', async () => {
  const definitions = [];
  const client = {
    async modelNames() { return []; },
    async createModel(definition) { definitions.push(definition); return null; },
    async modelFieldNames() { return [...ANKI_FIELD_NAMES]; },
  };
  assert.deepEqual(await ensureNoteModel(client), { modelName: MODEL_NAME, created: true });
  assert.equal(definitions.length, 1);
  assert.deepEqual(definitions[0].inOrderFields, ANKI_FIELD_NAMES);
});

test('incompatible fields and missing decks block instead of rebuilding', async () => {
  assert.throws(
    () => assertCompatibleModelFields(['Term', ...ANKI_FIELD_NAMES.slice(1)]),
    error => error.code === 'MODEL_INCOMPATIBLE',
  );

  const client = { async deckNames() { return ['Default']; } };
  await assert.rejects(assertDeckExists(client, 'Deleted'), error => error.code === 'DECK_MISSING');
});
