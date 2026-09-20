'use strict';

const { ANKI_NAMESPACE } = require('./runtime');

const MAX_TERM_CODE_POINTS = 256;
const MAX_CONTEXT_UNITS = 8000;
const MAX_LANGUAGE_LENGTH = 64;
const MAX_SOURCE_TEXT_LENGTH = 4096;

const CONTEXT_QUALITIES = Object.freeze(['sentence', 'fragment', 'selection_only']);
const SOURCE_KINDS = Object.freeze(['web', 'epub', 'pdf', 'subtitle', 'selection']);
const ANKI_FIELD_NAMES = Object.freeze([
  'CaptureId',
  'Language',
  'Term',
  'Reading',
  'Meaning',
  'Context',
  'SentenceTranslation',
  'Usage',
  'UserNote',
  'Source',
  'CapturedAt',
  'Audio',
]);
const ERROR_CODES = Object.freeze([
  'INPUT_INVALID',
  'RANGE_MISMATCH',
  'STORAGE_FAILED',
  'ANKI_API_ERROR',
  'PROVIDER_UNCONFIGURED',
  'AUTH_FAILED',
  'EXPLANATION_UNAVAILABLE',
  'ANKI_UNREACHABLE',
  'TIMEOUT',
  'API_UNSUPPORTED',
  'MODEL_INCOMPATIBLE',
  'DECK_MISSING',
  'PROFILE_MISMATCH',
  'IDENTITY_MISMATCH',
  'REMOTE_CHANGED',
  'MULTIPLE_MATCHES',
  'REMOTE_MISSING',
  'STALE_REVISION',
  'STALE_JOB',
  'AUDIO_UNAVAILABLE',
  'AUDIO_FAILED',
  'INTERNAL_ERROR',
  'UNSUPPORTED_MESSAGE',
]);

class ContractError extends Error {
  constructor(code, message, { retryable = false, details } = {}) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
    this.retryable = retryable;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError('INPUT_INVALID', `${label} must be an object.`);
  }
  return value;
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ContractError('INPUT_INVALID', `${label} contains unsupported field ${key}.`);
    }
  }
}

function assertBoundedString(value, label, maxLength, { allowEmpty = true } = {}) {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && value.length === 0)) {
    throw new ContractError('INPUT_INVALID', `${label} is invalid.`);
  }
  return value;
}

function isInsideSurrogatePair(text, offset) {
  if (offset <= 0 || offset >= text.length) {
    return false;
  }
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF;
}

function validateSource(source = {}) {
  assertPlainObject(source, 'source');
  assertKnownKeys(source, ['kind', 'url', 'title', 'locator', 'documentKey'], 'source');
  const kind = source.kind ?? 'selection';
  if (!SOURCE_KINDS.includes(kind)) {
    throw new ContractError('INPUT_INVALID', 'source.kind is invalid.');
  }

  const validated = { kind };
  for (const key of ['url', 'title', 'locator', 'documentKey']) {
    if (source[key] !== undefined) {
      validated[key] = assertBoundedString(source[key], `source.${key}`, MAX_SOURCE_TEXT_LENGTH);
    }
  }
  return Object.freeze(validated);
}

function validateOriginSnapshot(input) {
  assertPlainObject(input, 'originSnapshot');
  assertKnownKeys(input, [
    'language',
    'term',
    'contextText',
    'targetStart',
    'targetEnd',
    'contextQuality',
    'fallbackSourceKey',
    'source',
  ], 'originSnapshot');

  const rawLanguage = assertBoundedString(input.language, 'language', MAX_LANGUAGE_LENGTH, { allowEmpty: false }).trim();
  if (!rawLanguage || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(rawLanguage)) {
    throw new ContractError('INPUT_INVALID', 'language must be a concrete language identifier.');
  }
  const language = rawLanguage.toLowerCase();
  const contextText = assertBoundedString(input.contextText, 'contextText', MAX_CONTEXT_UNITS, { allowEmpty: false });
  const rawTerm = assertBoundedString(input.term, 'term', MAX_CONTEXT_UNITS, { allowEmpty: false });
  const targetStart = input.targetStart;
  const targetEnd = input.targetEnd;
  if (!Number.isInteger(targetStart) || !Number.isInteger(targetEnd)
      || targetStart < 0 || targetEnd <= targetStart || targetEnd > contextText.length) {
    throw new ContractError('RANGE_MISMATCH', 'Target offsets are outside the context.');
  }
  if (isInsideSurrogatePair(contextText, targetStart) || isInsideSurrogatePair(contextText, targetEnd)) {
    throw new ContractError('RANGE_MISMATCH', 'Target offsets split a Unicode surrogate pair.');
  }
  if (contextText.slice(targetStart, targetEnd) !== rawTerm) {
    throw new ContractError('RANGE_MISMATCH', 'Target offsets do not select the supplied term.');
  }

  const leadingWhitespace = rawTerm.length - rawTerm.trimStart().length;
  const trailingWhitespace = rawTerm.length - rawTerm.trimEnd().length;
  const term = rawTerm.slice(leadingWhitespace, rawTerm.length - trailingWhitespace);
  const adjustedStart = targetStart + leadingWhitespace;
  const adjustedEnd = targetEnd - trailingWhitespace;
  if (!term || [...term].length > MAX_TERM_CODE_POINTS) {
    throw new ContractError('INPUT_INVALID', 'term must contain 1 to 256 Unicode code points.');
  }
  if (isInsideSurrogatePair(contextText, adjustedStart) || isInsideSurrogatePair(contextText, adjustedEnd)
      || contextText.slice(adjustedStart, adjustedEnd) !== term) {
    throw new ContractError('RANGE_MISMATCH', 'Trimmed target offsets are invalid.');
  }

  const contextQuality = input.contextQuality;
  if (!CONTEXT_QUALITIES.includes(contextQuality)) {
    throw new ContractError('INPUT_INVALID', 'contextQuality is invalid.');
  }
  const fallbackSourceKey = input.fallbackSourceKey === undefined
    ? ''
    : assertBoundedString(input.fallbackSourceKey, 'fallbackSourceKey', MAX_SOURCE_TEXT_LENGTH);
  if (contextQuality === 'selection_only' && fallbackSourceKey.trim().length === 0) {
    throw new ContractError('INPUT_INVALID', 'selection_only captures require a stable fallbackSourceKey.');
  }

  return Object.freeze({
    language,
    term,
    contextText,
    targetStart: adjustedStart,
    targetEnd: adjustedEnd,
    contextQuality,
    fallbackSourceKey,
    source: validateSource(input.source),
  });
}

function validateMessageEnvelope(input, allowedTypes) {
  assertPlainObject(input, 'message');
  assertKnownKeys(input, ['namespace', 'requestId', 'type', 'payload'], 'message');
  if (input.namespace !== ANKI_NAMESPACE) {
    throw new ContractError('INPUT_INVALID', 'Unexpected message namespace.');
  }
  const requestId = assertBoundedString(input.requestId, 'requestId', 128, { allowEmpty: false });
  const type = assertBoundedString(input.type, 'type', 128, { allowEmpty: false });
  if (allowedTypes && !allowedTypes.includes(type)) {
    throw new ContractError('UNSUPPORTED_MESSAGE', 'Unsupported Anki integration message.');
  }
  const payload = assertPlainObject(input.payload, 'payload');
  return { namespace: ANKI_NAMESPACE, requestId, type, payload };
}

module.exports = {
  ANKI_FIELD_NAMES,
  CONTEXT_QUALITIES,
  ContractError,
  ERROR_CODES,
  MAX_CONTEXT_UNITS,
  MAX_TERM_CODE_POINTS,
  SOURCE_KINDS,
  isInsideSurrogatePair,
  validateMessageEnvelope,
  validateOriginSnapshot,
  validateSource,
};
