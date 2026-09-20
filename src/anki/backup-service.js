'use strict';

const { ANKI_FIELD_NAMES, ContractError, validateSource } = require('./contracts');
const { createCaptureIdentity, createTermKey, isCaptureId } = require('./identity');
const { MAX_MEDIA_BYTES, base64, sha256, validateAudio } = require('./media-service');

const BACKUP_KIND = 'lingkuma-anki-local-backup';
const BACKUP_SCHEMA_VERSION = 1;
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const MAX_BACKUP_CAPTURES = 50_000;
const CONTENT_KEYS = Object.freeze([
  'term', 'contextText', 'targetStart', 'targetEnd', 'meaning', 'sentenceTranslation',
  'reading', 'usage', 'userNote', 'source',
]);
const MANAGED_FIELDS = Object.freeze(ANKI_FIELD_NAMES.filter(name => name !== 'CaptureId'));

function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError('INPUT_INVALID', `${label} must be an object.`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const keys = Object.keys(plain(value, label));
  if (keys.some(key => !allowed.includes(key)) || allowed.some(key => !keys.includes(key))) {
    throw new ContractError('INPUT_INVALID', `${label} has an invalid schema.`);
  }
}

function boundedString(value, label, limit = 8_000) {
  if (typeof value !== 'string' || value.length > limit) {
    throw new ContractError('INPUT_INVALID', `${label} is invalid.`);
  }
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContractError('INPUT_INVALID', `${label} is invalid.`);
  }
  return value;
}

function validateFields(value, label) {
  if (value === null) return null;
  exactKeys(value, ANKI_FIELD_NAMES, label);
  return Object.fromEntries(ANKI_FIELD_NAMES.map(name => [name, boundedString(value[name], `${label}.${name}`, 65_536)]));
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new ContractError('INPUT_INVALID', 'Backup media data is invalid.');
  }
  const binary = typeof globalThis.atob === 'function' ? globalThis.atob(value) : Buffer.from(value, 'base64').toString('binary');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function exportCapture(capture) {
  return {
    schemaVersion: 1,
    captureId: capture.captureId,
    termKey: capture.termKey,
    originSnapshot: structuredClone(capture.originSnapshot),
    content: structuredClone(capture.content),
    contentState: capture.contentState,
    contentRevision: capture.contentRevision,
    enrichmentGeneration: capture.enrichmentGeneration,
    dirtyFields: [...(capture.dirtyFields || [])],
    locallyEditedFields: [...(capture.locallyEditedFields || [])],
    active: capture.active,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt,
    lastSeenAt: capture.lastSeenAt,
    mediaState: capture.mediaState,
    mediaHash: capture.mediaHash || null,
    destination: capture.destination ? structuredClone(capture.destination) : null,
    association: {
      wasLinked: Boolean(capture.link?.wasLinked),
      baseFields: capture.link?.baseFields ? structuredClone(capture.link.baseFields) : null,
    },
  };
}

function validateContent(value) {
  exactKeys(value, CONTENT_KEYS, 'capture.content');
  const result = {};
  for (const key of CONTENT_KEYS) {
    if (key === 'targetStart' || key === 'targetEnd') result[key] = integer(value[key], `content.${key}`);
    else if (key === 'source') result.source = validateSource(value.source);
    else result[key] = boundedString(value[key], `content.${key}`, key === 'term' ? 1_024 : 8_000);
  }
  if (result.targetEnd <= result.targetStart || result.targetEnd > result.contextText.length) {
    throw new ContractError('INPUT_INVALID', 'Backup content offsets are invalid.');
  }
  return result;
}

function validateDestination(value) {
  if (value === null) return null;
  exactKeys(value, ['expectedProfile', 'deckName', 'modelName'], 'capture.destination');
  return {
    expectedProfile: value.expectedProfile === null ? null : boundedString(value.expectedProfile, 'expectedProfile', 256),
    deckName: boundedString(value.deckName, 'deckName', 1_024),
    modelName: boundedString(value.modelName, 'modelName', 1_024),
  };
}

async function validateCapture(value) {
  const keys = [
    'schemaVersion', 'captureId', 'termKey', 'originSnapshot', 'content', 'contentState',
    'contentRevision', 'enrichmentGeneration', 'dirtyFields', 'locallyEditedFields', 'active',
    'createdAt', 'updatedAt', 'lastSeenAt', 'mediaState', 'mediaHash', 'destination', 'association',
  ];
  exactKeys(value, keys, 'capture');
  if (value.schemaVersion !== 1 || !isCaptureId(value.captureId) || typeof value.active !== 'boolean') {
    throw new ContractError('INPUT_INVALID', 'Backup capture metadata is invalid.');
  }
  const identity = await createCaptureIdentity(value.originSnapshot);
  const expectedTermKey = createTermKey(identity.normalizedLanguage, identity.normalizedTerm);
  if (identity.captureId !== value.captureId || value.termKey !== expectedTermKey) {
    throw new ContractError('IDENTITY_MISMATCH', 'Backup capture identity was modified.');
  }
  if (!['pending', 'ready', 'failed'].includes(value.contentState)
      || !['disabled', 'pending', 'ready', 'unavailable', 'failed'].includes(value.mediaState)) {
    throw new ContractError('INPUT_INVALID', 'Backup capture state is invalid.');
  }
  const fieldLists = [value.dirtyFields, value.locallyEditedFields];
  if (fieldLists.some(list => !Array.isArray(list)
      || list.some(field => !MANAGED_FIELDS.includes(field)) || new Set(list).size !== list.length)) {
    throw new ContractError('INPUT_INVALID', 'Backup field provenance is invalid.');
  }
  exactKeys(value.association, ['wasLinked', 'baseFields'], 'capture.association');
  if (typeof value.association.wasLinked !== 'boolean') {
    throw new ContractError('INPUT_INVALID', 'Backup association is invalid.');
  }
  const mediaHash = value.mediaHash === null ? null : boundedString(value.mediaHash, 'mediaHash', 64);
  if (mediaHash && !/^[0-9a-f]{64}$/.test(mediaHash)) throw new ContractError('INPUT_INVALID', 'Backup media hash is invalid.');
  const content = validateContent(value.content);
  const baseFields = validateFields(value.association.baseFields, 'capture.association.baseFields');
  if (baseFields && baseFields.CaptureId !== value.captureId) {
    throw new ContractError('IDENTITY_MISMATCH', 'Backup association points to a different capture.');
  }
  const now = Date.now();
  const dirtyFields = [...value.dirtyFields].sort();
  const wasLinked = value.association.wasLinked;
  return {
    schemaVersion: 1,
    captureId: value.captureId,
    termKey: expectedTermKey,
    originSnapshot: identity.snapshot,
    content,
    contentState: value.contentState,
    contentRevision: integer(value.contentRevision, 'contentRevision'),
    enrichmentGeneration: integer(value.enrichmentGeneration, 'enrichmentGeneration'),
    dirtyFields,
    locallyEditedFields: [...value.locallyEditedFields].sort(),
    active: value.active,
    createdAt: integer(value.createdAt, 'createdAt'),
    updatedAt: integer(value.updatedAt, 'updatedAt'),
    lastSeenAt: integer(value.lastSeenAt, 'lastSeenAt'),
    mediaState: mediaHash ? 'pending' : value.mediaState,
    ...(mediaHash ? { mediaHash } : {}),
    destination: validateDestination(value.destination),
    link: {
      noteIdHint: null,
      wasLinked,
      deliveryState: wasLinked ? 'pending' : 'conflict',
      baseFields,
      pendingWrite: null,
      lastVerifiedAt: null,
      lastError: wasLinked && dirtyFields.length === 0 ? null : {
        code: 'RESTORE_REVIEW_REQUIRED',
        message: 'Review this restored capture before writing it to Anki.',
        retryable: false,
      },
      observedRemoteFields: null,
    },
    restoredAt: now,
  };
}

async function validateMedia(value) {
  exactKeys(value, ['hash', 'mime', 'filename', 'data'], 'media');
  if (typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.hash)
      || typeof value.filename !== 'string' || !/^lk_audio_[0-9a-f]{64}\.(?:mp3|wav|ogg)$/.test(value.filename)) {
    throw new ContractError('INPUT_INVALID', 'Backup media metadata is invalid.');
  }
  const bytes = decodeBase64(value.data);
  const audio = validateAudio({ bytes, mime: value.mime });
  const actualHash = await sha256(audio.bytes);
  if (actualHash !== value.hash || !value.filename.startsWith(`lk_audio_${actualHash}.`)) {
    throw new ContractError('INPUT_INVALID', 'Backup media integrity check failed.');
  }
  return { hash: actualHash, mime: audio.mime, bytes: audio.bytes, filename: value.filename, ankiMediaFilename: null };
}

class BackupService {
  constructor({ backupStore, now = Date.now } = {}) {
    if (!backupStore) throw new TypeError('Backup store is required.');
    Object.assign(this, { backupStore, now });
  }

  async export({ includeMedia = false } = {}) {
    if (typeof includeMedia !== 'boolean') throw new ContractError('INPUT_INVALID', 'Backup options are invalid.');
    const snapshot = await this.backupStore.snapshot();
    const captures = snapshot.captures.map(exportCapture);
    const referenced = new Set(captures.map(capture => capture.mediaHash).filter(Boolean));
    const media = includeMedia ? snapshot.media.filter(item => referenced.has(item.hash)).map(item => ({
      hash: item.hash,
      mime: item.mime,
      filename: item.filename,
      data: base64(item.bytes),
    })) : [];
    const backup = { kind: BACKUP_KIND, schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: this.now(), captures, media };
    if (new TextEncoder().encode(JSON.stringify(backup)).length > MAX_BACKUP_BYTES) {
      throw new ContractError('INPUT_INVALID', 'The backup exceeds the supported size.');
    }
    return backup;
  }

  async import({ backup } = {}) {
    plain(backup, 'backup');
    let encoded;
    try {
      encoded = new TextEncoder().encode(JSON.stringify(backup));
    } catch (_) {
      throw new ContractError('INPUT_INVALID', 'The backup is not serializable.');
    }
    if (encoded.length > MAX_BACKUP_BYTES) throw new ContractError('INPUT_INVALID', 'The backup exceeds the supported size.');
    exactKeys(backup, ['kind', 'schemaVersion', 'exportedAt', 'captures', 'media'], 'backup');
    if (backup.kind !== BACKUP_KIND || backup.schemaVersion !== BACKUP_SCHEMA_VERSION
        || !Number.isSafeInteger(backup.exportedAt) || backup.exportedAt < 0
        || !Array.isArray(backup.captures) || backup.captures.length > MAX_BACKUP_CAPTURES
        || !Array.isArray(backup.media)) {
      throw new ContractError('INPUT_INVALID', 'The backup header is invalid.');
    }
    const captures = [];
    const captureIds = new Set();
    for (const value of backup.captures) {
      const capture = await validateCapture(value);
      if (captureIds.has(capture.captureId)) throw new ContractError('INPUT_INVALID', 'The backup contains duplicate captures.');
      captureIds.add(capture.captureId);
      captures.push(capture);
    }
    const media = [];
    const mediaHashes = new Set();
    for (const value of backup.media) {
      const item = await validateMedia(value);
      if (mediaHashes.has(item.hash)) throw new ContractError('INPUT_INVALID', 'The backup contains duplicate media.');
      mediaHashes.add(item.hash);
      media.push(item);
    }
    if (captures.some(capture => capture.mediaHash && !mediaHashes.has(capture.mediaHash))) {
      for (const capture of captures) {
        if (capture.mediaHash && !mediaHashes.has(capture.mediaHash)) {
          delete capture.mediaHash;
          capture.mediaState = 'unavailable';
        }
      }
    }
    return this.backupStore.import({ captures, media });
  }
}

module.exports = {
  BACKUP_KIND,
  BACKUP_SCHEMA_VERSION,
  BackupService,
  MAX_BACKUP_BYTES,
  exportCapture,
  validateCapture,
};
