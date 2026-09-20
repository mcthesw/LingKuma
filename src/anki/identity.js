'use strict';

const { ContractError, validateOriginSnapshot } = require('./contracts');

const IDENTITY_VERSION = 1;
const CAPTURE_ID_PREFIX = 'lk1_';

function normalizeIdentityText(value) {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle?.digest) {
    throw new Error('Web Crypto SHA-256 support is required.');
  }
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function buildIdentityParts(input) {
  const snapshot = validateOriginSnapshot(input);
  const normalizedLanguage = snapshot.language.toLowerCase();
  const normalizedTerm = normalizeIdentityText(snapshot.term);
  const normalizedContext = normalizeIdentityText(snapshot.contextText);
  const normalizedEnd = normalizeIdentityText(snapshot.contextText.slice(0, snapshot.targetEnd)).length;
  const normalizedStart = normalizedEnd - normalizedTerm.length;

  if (normalizedStart < 0
      || normalizedContext.slice(normalizedStart, normalizedEnd) !== normalizedTerm) {
    throw new ContractError('RANGE_MISMATCH', 'Normalized target no longer matches the selected term.');
  }

  const fallbackSourceKey = snapshot.contextQuality === 'selection_only'
    ? snapshot.fallbackSourceKey
    : '';
  const identityTuple = Object.freeze([
    IDENTITY_VERSION,
    normalizedLanguage,
    normalizedTerm,
    normalizedContext,
    normalizedStart,
    normalizedEnd,
    fallbackSourceKey,
  ]);

  return Object.freeze({
    snapshot,
    normalizedLanguage,
    normalizedTerm,
    normalizedContext,
    normalizedStart,
    normalizedEnd,
    fallbackSourceKey,
    identityTuple,
  });
}

async function createCaptureIdentity(input, { cryptoApi = globalThis.crypto } = {}) {
  const parts = buildIdentityParts(input);
  const captureId = CAPTURE_ID_PREFIX + await sha256Hex(JSON.stringify(parts.identityTuple), cryptoApi);
  return Object.freeze({ ...parts, captureId });
}

function createTermKey(language, term) {
  if (typeof language !== 'string' || typeof term !== 'string') {
    throw new ContractError('INPUT_INVALID', 'language and term are required for termKey.');
  }
  return `${language.trim().toLowerCase()}\u0000${normalizeIdentityText(term).toLocaleLowerCase('und')}`;
}

function isCaptureId(value) {
  return typeof value === 'string' && /^lk1_[0-9a-f]{64}$/.test(value);
}

module.exports = {
  CAPTURE_ID_PREFIX,
  IDENTITY_VERSION,
  buildIdentityParts,
  createCaptureIdentity,
  createTermKey,
  isCaptureId,
  normalizeIdentityText,
  sha256Hex,
};
