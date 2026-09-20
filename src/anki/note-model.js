'use strict';

const { ANKI_FIELD_NAMES, ContractError } = require('./contracts');
const { isCaptureId } = require('./identity');

const MODEL_NAME = 'LingKuma Lookup v1';
const MODEL_CSS = `
.card {
  font-family: Arial, sans-serif;
  font-size: 20px;
  line-height: 1.5;
  color: #202124;
  background: #fff;
  text-align: left;
  max-width: 48rem;
  margin: 0 auto;
}
.lk-term { font-size: 1.6em; font-weight: 700; margin-bottom: .6rem; }
.lk-reading, .lk-usage, .lk-source { color: #5f6368; font-size: .85em; }
.lk-context { margin: .8rem 0; }
.lk-target { color: #0b57d0; }
.lk-meaning { font-size: 1.15em; font-weight: 600; }
.lk-translation, .lk-note { margin-top: .7rem; }
`.trim();
const CARD_TEMPLATES = Object.freeze([{
  Name: 'Lookup',
  Front: '<div class="lk-term">{{Term}}</div>{{#Reading}}<div class="lk-reading">{{Reading}}</div>{{/Reading}}<div class="lk-context">{{Context}}</div>',
  Back: '{{FrontSide}}<hr id="answer"><div class="lk-meaning">{{Meaning}}</div>{{#SentenceTranslation}}<div class="lk-translation">{{SentenceTranslation}}</div>{{/SentenceTranslation}}{{#Usage}}<div class="lk-usage">{{Usage}}</div>{{/Usage}}{{#UserNote}}<div class="lk-note">{{UserNote}}</div>{{/UserNote}}{{#Source}}<div class="lk-source">{{Source}}</div>{{/Source}}{{Audio}}',
}]);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeFieldText(value) {
  return escapeHtml(value)
    .replace(/\\/g, '&#92;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;');
}

function renderContext(content) {
  const text = content.contextText;
  const start = content.targetStart;
  const end = content.targetEnd;
  if (typeof text !== 'string' || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end <= start || end > text.length
      || text.slice(start, end) !== content.term) {
    throw new ContractError('RANGE_MISMATCH', 'Capture content no longer identifies its target range.');
  }
  return `${escapeFieldText(text.slice(0, start))}<strong class="lk-target">${escapeFieldText(text.slice(start, end))}</strong>${escapeFieldText(text.slice(end))}`;
}

function safeSourceUrl(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch (_) {
    return null;
  }
}

function renderSource(source) {
  if (!source || typeof source !== 'object') {
    return '';
  }
  const title = source.title || source.documentKey || source.url || source.kind || '';
  const url = safeSourceUrl(source.url);
  const primary = url
    ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeFieldText(title)}</a>`
    : escapeFieldText(title);
  const locator = source.locator ? ` · ${escapeFieldText(source.locator)}` : '';
  return `${primary}${locator}`;
}

function renderAudio(media) {
  const filename = media?.ankiMediaFilename;
  if (typeof filename !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(filename)) {
    return '';
  }
  return `[sound:${filename}]`;
}

function renderFields(capture, media = capture) {
  if (!capture || !isCaptureId(capture.captureId)) {
    throw new ContractError('INPUT_INVALID', 'Capture identity is invalid.');
  }
  const content = capture.content || {};
  return {
    CaptureId: capture.captureId,
    Language: escapeFieldText(capture.originSnapshot?.language || ''),
    Term: escapeFieldText(content.term),
    Reading: escapeFieldText(content.reading),
    Meaning: escapeFieldText(content.meaning),
    Context: renderContext(content),
    SentenceTranslation: escapeFieldText(content.sentenceTranslation),
    Usage: escapeFieldText(content.usage),
    UserNote: escapeFieldText(content.userNote),
    Source: renderSource(content.source),
    CapturedAt: new Date(capture.createdAt).toISOString(),
    Audio: renderAudio(media),
  };
}

function createModelDefinition(modelName = MODEL_NAME) {
  return {
    modelName,
    inOrderFields: [...ANKI_FIELD_NAMES],
    css: MODEL_CSS,
    isCloze: false,
    cardTemplates: CARD_TEMPLATES.map(template => ({ ...template })),
  };
}

function assertCompatibleModelFields(actualFields) {
  if (!Array.isArray(actualFields)
      || actualFields.length !== ANKI_FIELD_NAMES.length
      || actualFields.some((field, index) => field !== ANKI_FIELD_NAMES[index])) {
    throw new ContractError('MODEL_INCOMPATIBLE', 'The LingKuma note type fields or field order are incompatible.', {
      details: { expectedFields: [...ANKI_FIELD_NAMES], actualFields: Array.isArray(actualFields) ? [...actualFields] : null },
    });
  }
  return true;
}

async function ensureNoteModel(ankiClient, { modelName = MODEL_NAME } = {}) {
  const modelNames = await ankiClient.modelNames();
  if (!Array.isArray(modelNames)) {
    throw new ContractError('API_UNSUPPORTED', 'modelNames returned an invalid result.');
  }
  if (modelNames.includes(modelName)) {
    assertCompatibleModelFields(await ankiClient.modelFieldNames(modelName));
    return { modelName, created: false };
  }

  await ankiClient.createModel(createModelDefinition(modelName));
  assertCompatibleModelFields(await ankiClient.modelFieldNames(modelName));
  return { modelName, created: true };
}

async function assertDeckExists(ankiClient, deckName) {
  if (typeof deckName !== 'string' || !deckName.trim()) {
    throw new ContractError('DECK_MISSING', 'A target deck is required.');
  }
  const deckNames = await ankiClient.deckNames();
  if (!Array.isArray(deckNames) || !deckNames.includes(deckName)) {
    throw new ContractError('DECK_MISSING', 'The configured Anki deck no longer exists.', {
      details: { deckName },
    });
  }
  return true;
}

function buildAnkiNote(capture, { deckName, modelName = MODEL_NAME } = {}, media = capture) {
  if (typeof deckName !== 'string' || !deckName.trim() || typeof modelName !== 'string' || !modelName.trim()) {
    throw new ContractError('INPUT_INVALID', 'Anki destination is incomplete.');
  }
  return {
    deckName,
    modelName,
    fields: renderFields(capture, media),
    options: { allowDuplicate: false },
    tags: ['lingkuma::lookup'],
  };
}

module.exports = {
  CARD_TEMPLATES,
  MODEL_CSS,
  MODEL_NAME,
  assertCompatibleModelFields,
  assertDeckExists,
  buildAnkiNote,
  createModelDefinition,
  ensureNoteModel,
  escapeFieldText,
  escapeHtml,
  renderAudio,
  renderContext,
  renderFields,
  renderSource,
  safeSourceUrl,
};
