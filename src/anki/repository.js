'use strict';

const { ContractError } = require('./contracts');
const { createCaptureIdentity, createTermKey } = require('./identity');
const {
  clone,
  requestResult,
  storageError,
  transactionDone,
} = require('./indexeddb-store');
const {
  requestRecreate: requestRecreateTransaction,
  resolveRemoteDifference: resolveRemoteDifferenceTransaction,
} = require('./reconciliation-store');
const {
  bindUnconfiguredCaptures: bindUnconfiguredCapturesTransaction,
  deferJob: deferJobTransaction,
  getJobSchedule: getJobScheduleTransaction,
  requeueBlockedPushes: requeueBlockedPushesTransaction,
} = require('./queue-store');

const DATABASE_NAME = 'lingkuma-anki-v1';
const DATABASE_VERSION = 1;
const STORE_NAMES = Object.freeze(['captures', 'jobs', 'media', 'meta']);
const JOB_KINDS = Object.freeze(['enrich', 'push', 'media']);
const CONTENT_TO_ANKI_FIELD = Object.freeze({
  term: 'Term',
  contextText: 'Context',
  meaning: 'Meaning',
  sentenceTranslation: 'SentenceTranslation',
  reading: 'Reading',
  usage: 'Usage',
  userNote: 'UserNote',
  source: 'Source',
});

function initializeSchema(database, oldVersion) {
  if (oldVersion < 1) {
    const captures = database.createObjectStore('captures', { keyPath: 'captureId' });
    captures.createIndex('termKey', 'termKey', { unique: false });
    captures.createIndex('updatedAt', 'updatedAt', { unique: false });
    captures.createIndex('deliveryState', 'link.deliveryState', { unique: false });
    captures.createIndex('pendingWriteOpId', 'link.pendingWrite.opId', { unique: true });

    const jobs = database.createObjectStore('jobs', { keyPath: 'jobId' });
    jobs.createIndex('captureId', 'captureId', { unique: false });
    jobs.createIndex('kind', 'kind', { unique: false });
    jobs.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });

    database.createObjectStore('media', { keyPath: 'hash' });
    database.createObjectStore('meta', { keyPath: 'key' });
  }
}

function openDatabase(indexedDBApi, name) {
  return new Promise((resolve, reject) => {
    const request = indexedDBApi.open(name, DATABASE_VERSION);
    request.onupgradeneeded = event => {
      try {
        initializeSchema(request.result, event.oldVersion);
      } catch (error) {
        request.transaction.abort();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked.'));
  });
}

function verifySchema(database) {
  for (const storeName of STORE_NAMES) {
    if (!database.objectStoreNames.contains(storeName)) {
      throw new Error(`IndexedDB store ${storeName} is missing.`);
    }
  }
}

function defaultContent(snapshot, defaults) {
  return {
    term: snapshot.term,
    contextText: snapshot.contextText,
    targetStart: snapshot.targetStart,
    targetEnd: snapshot.targetEnd,
    meaning: '',
    sentenceTranslation: '',
    reading: '',
    usage: '',
    userNote: '',
    source: snapshot.source,
    ...(defaults.content || {}),
  };
}

function createJob(captureId, kind, now, { revision = 0, generation = 0, inputKey } = {}) {
  if (!JOB_KINDS.includes(kind)) {
    throw new ContractError('INPUT_INVALID', `Unsupported job kind ${kind}.`);
  }
  return {
    jobId: `${captureId}:${kind}`,
    captureId,
    kind,
    requestedRevision: revision,
    generation,
    attemptCount: 0,
    nextAttemptAt: now,
    leaseOwner: null,
    leaseUntil: null,
    lastError: null,
    ...(inputKey ? { inputKey } : {}),
  };
}

function mergeDirtyFields(current, fields) {
  return Array.from(new Set([...(current || []), ...fields])).sort();
}

function patchNestedCapture(capture, patch) {
  if (patch.contentPatch) {
    capture.content = { ...capture.content, ...patch.contentPatch };
  }
  if (patch.linkPatch) {
    capture.link = { ...capture.link, ...patch.linkPatch };
  }
  for (const [key, value] of Object.entries(patch.capturePatch || {})) {
    capture[key] = value;
  }
}

class AnkiRepository {
  constructor(database, { now = Date.now } = {}) {
    this.database = database;
    this.now = now;
  }

  close() {
    this.database.close();
  }

  async createOrGetCapture(originSnapshot, defaults = {}, { createIfMissing = true } = {}) {
    const identity = await createCaptureIdentity(originSnapshot);
    const now = this.now();
    let transaction;
    try {
      transaction = this.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      let capture = await requestResult(captures.get(identity.captureId));
      let created = false;

      if (capture) {
        capture.lastSeenAt = now;
        capture.updatedAt = Math.max(capture.updatedAt, now);
        captures.put(capture);
      } else if (createIfMissing) {
        const content = defaultContent(identity.snapshot, defaults);
        const hasMeaning = typeof content.meaning === 'string' && content.meaning.trim().length > 0;
        capture = {
          schemaVersion: 1,
          captureId: identity.captureId,
          termKey: createTermKey(identity.normalizedLanguage, identity.normalizedTerm),
          originSnapshot: identity.snapshot,
          content,
          contentState: hasMeaning ? 'ready' : 'pending',
          contentRevision: 0,
          enrichmentGeneration: 1,
          dirtyFields: hasMeaning ? Object.values(CONTENT_TO_ANKI_FIELD) : [],
          active: true,
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
          mediaState: defaults.mediaState || 'disabled',
          ...(defaults.destination ? { destination: clone(defaults.destination) } : {}),
          link: {
            noteIdHint: null,
            wasLinked: false,
            deliveryState: 'pending',
            baseFields: null,
            pendingWrite: null,
            lastVerifiedAt: null,
            lastError: null,
            observedRemoteFields: null,
          },
        };
        captures.add(capture);
        if (!hasMeaning) {
          jobs.add(createJob(capture.captureId, 'enrich', now, { generation: 1 }));
        } else {
          jobs.add(createJob(capture.captureId, 'push', now, { revision: 0 }));
        }
        if (capture.mediaState === 'pending') {
          jobs.add(createJob(capture.captureId, 'media', now));
        }
        created = true;
      }

      await transactionDone(transaction);
      return { capture: capture ? clone(capture) : null, created };
    } catch (error) {
      if (transaction) {
        try {
          transaction.abort();
        } catch (_) {
          // The transaction may already have completed or aborted.
        }
      }
      throw storageError(error);
    }
  }

  async getCapture(captureId) {
    try {
      const transaction = this.database.transaction('captures', 'readonly');
      const capture = await requestResult(transaction.objectStore('captures').get(captureId));
      await transactionDone(transaction);
      return capture ? clone(capture) : null;
    } catch (error) {
      throw storageError(error);
    }
  }

  async patchContent(captureId, expectedRevision, patch) {
    const allowed = Object.keys(CONTENT_TO_ANKI_FIELD);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some(key => !allowed.includes(key))) {
      throw new ContractError('INPUT_INVALID', 'Content patch contains unsupported fields.');
    }

    try {
      const transaction = this.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const capture = await requestResult(captures.get(captureId));
      if (!capture) {
        throw new ContractError('INPUT_INVALID', 'Capture does not exist.');
      }
      if (capture.contentRevision !== expectedRevision) {
        throw new ContractError('STALE_REVISION', 'Capture was edited by another operation.', {
          details: { current: clone(capture) },
        });
      }

      const changedKeys = [];
      for (const [key, value] of Object.entries(patch)) {
        if (capture.content[key] !== value) {
          capture.content[key] = value;
          changedKeys.push(key);
        }
      }
      if (changedKeys.length === 0) {
        await transactionDone(transaction);
        return clone(capture);
      }

      capture.contentRevision += 1;
      capture.enrichmentGeneration += 1;
      capture.updatedAt = this.now();
      capture.dirtyFields = mergeDirtyFields(
        capture.dirtyFields,
        changedKeys.map(key => CONTENT_TO_ANKI_FIELD[key]).filter(Boolean),
      );
      const hasMeaning = typeof capture.content.meaning === 'string' && capture.content.meaning.trim().length > 0;
      capture.contentState = hasMeaning ? 'ready' : 'pending';
      captures.put(capture);

      if (hasMeaning) {
        jobs.delete(`${captureId}:enrich`);
        const job = createJob(captureId, 'push', capture.updatedAt, { revision: capture.contentRevision });
        const previous = await requestResult(jobs.get(job.jobId));
        jobs.put({ ...previous, ...job, attemptCount: previous?.attemptCount || 0 });
      } else {
        jobs.delete(`${captureId}:push`);
        const job = createJob(captureId, 'enrich', capture.updatedAt, {
          revision: capture.contentRevision,
          generation: capture.enrichmentGeneration,
        });
        jobs.put(job);
      }

      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }

  async claimDueJob(kind, now, ownerToken, leaseMs = 30_000) {
    if (!JOB_KINDS.includes(kind) || !ownerToken || leaseMs <= 0) {
      throw new ContractError('INPUT_INVALID', 'Invalid job claim.');
    }
    try {
      const transaction = this.database.transaction('jobs', 'readwrite');
      const store = transaction.objectStore('jobs');
      const allJobs = await requestResult(store.getAll());
      const job = allJobs
        .filter(candidate => candidate.kind === kind
          && candidate.nextAttemptAt <= now
          && (!candidate.leaseUntil || candidate.leaseUntil <= now))
        .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt || left.jobId.localeCompare(right.jobId))[0];
      if (job) {
        job.leaseOwner = ownerToken;
        job.leaseUntil = now + leaseMs;
        store.put(job);
      }
      await transactionDone(transaction);
      return job ? clone(job) : null;
    } catch (error) {
      throw storageError(error);
    }
  }

  async commitJobResult(jobToken, expectedGeneration, result = {}) {
    if (!jobToken?.jobId || !jobToken?.ownerToken) {
      throw new ContractError('INPUT_INVALID', 'Invalid job token.');
    }
    try {
      const transaction = this.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const job = await requestResult(jobs.get(jobToken.jobId));
      if (!job || job.leaseOwner !== jobToken.ownerToken || job.generation !== expectedGeneration) {
        await transactionDone(transaction);
        return 'stale';
      }
      const capture = await requestResult(captures.get(job.captureId));
      if (!capture || (job.kind === 'enrich' && capture.enrichmentGeneration !== expectedGeneration)) {
        await transactionDone(transaction);
        return 'stale';
      }

      patchNestedCapture(capture, result);
      capture.updatedAt = this.now();
      captures.put(capture);
      if (result.keepJob === true) {
        job.leaseOwner = null;
        job.leaseUntil = null;
        jobs.put(job);
      } else {
        jobs.delete(job.jobId);
      }
      for (const requested of result.enqueueJobs || []) {
        const next = createJob(capture.captureId, requested.kind, this.now(), {
          revision: requested.revision ?? capture.contentRevision,
          generation: requested.generation ?? capture.enrichmentGeneration,
          inputKey: requested.inputKey,
        });
        jobs.put(next);
      }
      await transactionDone(transaction);
      return 'committed';
    } catch (error) {
      throw storageError(error);
    }
  }

  async rescheduleJob(jobToken, { nextAttemptAt, lastError = null, incrementAttempt = true } = {}) {
    try {
      const transaction = this.database.transaction('jobs', 'readwrite');
      const store = transaction.objectStore('jobs');
      const job = await requestResult(store.get(jobToken.jobId));
      if (!job || job.leaseOwner !== jobToken.ownerToken) {
        await transactionDone(transaction);
        return 'stale';
      }
      job.attemptCount += incrementAttempt ? 1 : 0;
      job.nextAttemptAt = nextAttemptAt;
      job.lastError = lastError;
      job.leaseOwner = null;
      job.leaseUntil = null;
      store.put(job);
      await transactionDone(transaction);
      return 'committed';
    } catch (error) {
      throw storageError(error);
    }
  }

  async prepareWrite(captureId, sentRevision, intendedFields, previousBase, {
    opId,
    kind = 'update',
    jobToken = null,
    submittedFields = Object.keys(intendedFields || {}),
  } = {}) {
    if (!opId || !['create', 'update'].includes(kind)) {
      throw new ContractError('INPUT_INVALID', 'Invalid pending write.');
    }
    try {
      const storeNames = jobToken ? ['captures', 'jobs'] : ['captures'];
      const transaction = this.database.transaction(storeNames, 'readwrite');
      const store = transaction.objectStore('captures');
      if (jobToken) {
        const job = await requestResult(transaction.objectStore('jobs').get(jobToken.jobId));
        if (!job || job.leaseOwner !== jobToken.ownerToken || job.requestedRevision !== sentRevision) {
          await transactionDone(transaction);
          return null;
        }
      }
      const capture = await requestResult(store.get(captureId));
      if (!capture) {
        throw new ContractError('INPUT_INVALID', 'Capture does not exist.');
      }
      capture.link.pendingWrite = {
        opId,
        kind,
        sentRevision,
        intendedFields: clone(intendedFields),
        previousBase: clone(previousBase),
        submittedFields: [...submittedFields],
      };
      capture.updatedAt = this.now();
      store.put(capture);
      await transactionDone(transaction);
      return clone(capture.link.pendingWrite);
    } catch (error) {
      throw storageError(error);
    }
  }

  async confirmWrite(opId, observedFields, noteId, currentRevision = null, currentIntendedFields = null) {
    try {
      const transaction = this.database.transaction('captures', 'readwrite');
      const store = transaction.objectStore('captures');
      const capture = await requestResult(store.index('pendingWriteOpId').get(opId));
      if (!capture) {
        await transactionDone(transaction);
        return null;
      }
      const pending = capture.link.pendingWrite;
      capture.link.pendingWrite = null;
      capture.link.baseFields = clone(observedFields);
      capture.link.noteIdHint = noteId;
      capture.link.wasLinked = true;
      capture.link.deliveryState = 'synced';
      capture.link.lastVerifiedAt = this.now();
      capture.link.lastError = null;
      capture.link.observedRemoteFields = null;
      const submittedFields = pending.submittedFields || Object.keys(pending.intendedFields || {});
      const currentIsKnown = currentRevision === null
        ? capture.contentRevision === pending.sentRevision
        : capture.contentRevision === currentRevision && currentIntendedFields;
      capture.dirtyFields = (capture.dirtyFields || []).filter(field =>
        !submittedFields.includes(field)
          || observedFields[field] !== pending.intendedFields[field]
          || !currentIsKnown
          || (currentIntendedFields && currentIntendedFields[field] !== pending.intendedFields[field]));
      capture.updatedAt = this.now();
      store.put(capture);
      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }

  async recordRemoteDifference(captureId, observedFields, reason = 'REMOTE_CHANGED') {
    try {
      const transaction = this.database.transaction('captures', 'readwrite');
      const store = transaction.objectStore('captures');
      const capture = await requestResult(store.get(captureId));
      if (!capture) {
        throw new ContractError('INPUT_INVALID', 'Capture does not exist.');
      }
      capture.link.deliveryState = 'conflict';
      capture.link.observedRemoteFields = clone(observedFields);
      capture.link.lastError = { code: reason, retryable: false };
      capture.updatedAt = this.now();
      store.put(capture);
      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }

  resolveRemoteDifference(captureId, expectedRevision, observedFields, noteId, localFields) {
    return resolveRemoteDifferenceTransaction(this, createJob, {
      captureId,
      expectedRevision,
      observedFields,
      noteId,
      localFields,
    });
  }

  requestRecreate(captureId, expectedRevision) {
    return requestRecreateTransaction(
      this,
      createJob,
      Object.values(CONTENT_TO_ANKI_FIELD),
      captureId,
      expectedRevision,
    );
  }

  async setDeliveryState(captureId, deliveryState, lastError = null) {
    const allowedStates = ['pending', 'synced', 'conflict', 'remote_missing', 'blocked'];
    if (!allowedStates.includes(deliveryState)) {
      throw new ContractError('INPUT_INVALID', 'Invalid delivery state.');
    }
    try {
      const transaction = this.database.transaction('captures', 'readwrite');
      const store = transaction.objectStore('captures');
      const capture = await requestResult(store.get(captureId));
      if (!capture) {
        throw new ContractError('INPUT_INVALID', 'Capture does not exist.');
      }
      capture.link.deliveryState = deliveryState;
      capture.link.lastError = lastError ? clone(lastError) : null;
      capture.updatedAt = this.now();
      store.put(capture);
      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }

  async excludeCapture(captureId) {
    try {
      const transaction = this.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const capture = await requestResult(captures.get(captureId));
      if (!capture) {
        throw new ContractError('INPUT_INVALID', 'Capture does not exist.');
      }
      capture.active = false;
      capture.updatedAt = this.now();
      captures.put(capture);
      const allJobs = await requestResult(jobs.getAll());
      for (const job of allJobs) {
        if (job.captureId === captureId) {
          jobs.delete(job.jobId);
        }
      }
      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }

  async resumeCapture(captureId) {
    try {
      const transaction = this.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const capture = await requestResult(captures.get(captureId));
      if (!capture) {
        throw new ContractError('INPUT_INVALID', 'Capture does not exist.');
      }
      capture.active = true;
      capture.updatedAt = this.now();
      captures.put(capture);
      if (!['conflict', 'remote_missing', 'blocked'].includes(capture.link.deliveryState)) {
        if (capture.contentState !== 'ready') {
          jobs.put(createJob(captureId, 'enrich', capture.updatedAt, {
            revision: capture.contentRevision,
            generation: capture.enrichmentGeneration,
          }));
        } else if ((capture.dirtyFields || []).length > 0 || !capture.link.wasLinked) {
          jobs.put(createJob(captureId, 'push', capture.updatedAt, {
            revision: capture.contentRevision,
          }));
        }
        if (capture.mediaState === 'pending') jobs.put(createJob(captureId, 'media', capture.updatedAt));
      }
      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }

  async requestRegeneration(captureId, expectedRevision) {
    try {
      const transaction = this.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const capture = await requestResult(captures.get(captureId));
      if (!capture) {
        throw new ContractError('INPUT_INVALID', 'Capture does not exist.');
      }
      if (!capture.active) {
        throw new ContractError('INPUT_INVALID', 'Excluded captures must be resumed before regeneration.');
      }
      if (capture.contentRevision !== expectedRevision) {
        throw new ContractError('STALE_REVISION', 'Capture was edited by another operation.', {
          details: { current: clone(capture) },
        });
      }
      capture.enrichmentGeneration += 1;
      capture.contentState = 'pending';
      capture.updatedAt = this.now();
      captures.put(capture);
      jobs.delete(`${captureId}:push`);
      jobs.put(createJob(captureId, 'enrich', capture.updatedAt, {
        revision: capture.contentRevision,
        generation: capture.enrichmentGeneration,
      }));
      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }

  async listCaptures({ state, active, termKey, cursor, limit = 50 } = {}) {
    const boundedLimit = Math.max(1, Math.min(100, limit));
    try {
      const transaction = this.database.transaction('captures', 'readonly');
      let captures = await requestResult(transaction.objectStore('captures').getAll());
      await transactionDone(transaction);
      captures = captures
        .filter(capture => state === undefined || capture.link.deliveryState === state)
        .filter(capture => active === undefined || capture.active === active)
        .filter(capture => termKey === undefined || capture.termKey === termKey)
        .sort((left, right) => right.updatedAt - left.updatedAt || left.captureId.localeCompare(right.captureId));
      if (cursor) {
        const index = captures.findIndex(capture => `${capture.updatedAt}:${capture.captureId}` === cursor);
        captures = index >= 0 ? captures.slice(index + 1) : captures;
      }
      const items = captures.slice(0, boundedLimit);
      const last = items.at(-1);
      return {
        items: clone(items),
        nextCursor: captures.length > items.length && last ? `${last.updatedAt}:${last.captureId}` : null,
      };
    } catch (error) {
      throw storageError(error);
    }
  }

  bindUnconfiguredCaptures(destination) {
    return bindUnconfiguredCapturesTransaction(this, destination);
  }

  getJobSchedule() {
    return getJobScheduleTransaction(this);
  }

  requeueBlockedPushes() {
    return requeueBlockedPushesTransaction(this, createJob);
  }

  deferJob(jobId, nextAttemptAt) {
    return deferJobTransaction(this, jobId, nextAttemptAt);
  }

  async getMeta(key) {
    try {
      const transaction = this.database.transaction('meta', 'readonly');
      const entry = await requestResult(transaction.objectStore('meta').get(key));
      await transactionDone(transaction);
      return entry ? clone(entry.value) : null;
    } catch (error) {
      throw storageError(error);
    }
  }

  async setMeta(key, value) {
    try {
      const transaction = this.database.transaction('meta', 'readwrite');
      transaction.objectStore('meta').put({ key, value: clone(value) });
      await transactionDone(transaction);
    } catch (error) {
      throw storageError(error);
    }
  }
}

async function openAnkiRepository({
  indexedDB: indexedDBApi = globalThis.indexedDB,
  name = DATABASE_NAME,
  now = Date.now,
} = {}) {
  if (!indexedDBApi?.open) {
    throw new ContractError('STORAGE_FAILED', 'IndexedDB is unavailable.');
  }
  let database;
  try {
    database = await openDatabase(indexedDBApi, name);
    verifySchema(database);
    return new AnkiRepository(database, { now });
  } catch (error) {
    database?.close();
    throw storageError(error);
  }
}

module.exports = {
  AnkiRepository,
  CONTENT_TO_ANKI_FIELD,
  DATABASE_NAME,
  DATABASE_VERSION,
  JOB_KINDS,
  STORE_NAMES,
  createJob,
  openAnkiRepository,
};
