'use strict';

const { ANKI_FIELD_NAMES, ContractError } = require('./contracts');
const {
  clone,
  requestResult,
  storageError,
  transactionDone,
} = require('./indexeddb-store');

async function resolveRemoteDifference(repository, createJob, {
  captureId,
  expectedRevision,
  observedFields,
  noteId,
  localFields,
}) {
  const selected = Array.from(new Set(localFields || [])).sort();
  if (!Number.isInteger(expectedRevision)
      || !Number.isSafeInteger(noteId) || noteId <= 0
      || selected.some(field => !ANKI_FIELD_NAMES.includes(field) || field === 'CaptureId')) {
    throw new ContractError('INPUT_INVALID', 'Conflict resolution is invalid.');
  }
  try {
    const transaction = repository.database.transaction(['captures', 'jobs'], 'readwrite');
    const captures = transaction.objectStore('captures');
    const jobs = transaction.objectStore('jobs');
    const capture = await requestResult(captures.get(captureId));
    if (!capture || capture.contentRevision !== expectedRevision
        || capture.link.deliveryState !== 'conflict') {
      throw new ContractError('STALE_REVISION', 'The conflict changed before it was resolved.');
    }
    capture.link.baseFields = clone(observedFields);
    capture.link.observedRemoteFields = null;
    capture.link.pendingWrite = null;
    capture.link.noteIdHint = noteId;
    capture.link.wasLinked = true;
    capture.link.lastVerifiedAt = repository.now();
    capture.link.lastError = null;
    capture.dirtyFields = selected;
    capture.link.deliveryState = selected.length > 0 ? 'pending' : 'synced';
    capture.updatedAt = repository.now();
    captures.put(capture);
    if (selected.length > 0) {
      jobs.put(createJob(captureId, 'push', capture.updatedAt, { revision: capture.contentRevision }));
    } else {
      jobs.delete(`${captureId}:push`);
    }
    await transactionDone(transaction);
    return clone(capture);
  } catch (error) {
    throw storageError(error);
  }
}

async function requestRecreate(repository, createJob, contentFields, captureId, expectedRevision) {
  try {
    const transaction = repository.database.transaction(['captures', 'jobs'], 'readwrite');
    const captures = transaction.objectStore('captures');
    const jobs = transaction.objectStore('jobs');
    const capture = await requestResult(captures.get(captureId));
    if (!capture || capture.contentRevision !== expectedRevision
        || capture.link.deliveryState !== 'remote_missing') {
      throw new ContractError('STALE_REVISION', 'The missing-note state changed before recreation.');
    }
    capture.link = {
      ...capture.link,
      noteIdHint: null,
      wasLinked: false,
      deliveryState: 'pending',
      baseFields: null,
      pendingWrite: null,
      lastError: null,
      observedRemoteFields: null,
    };
    capture.dirtyFields = Array.from(new Set(contentFields)).sort();
    capture.updatedAt = repository.now();
    captures.put(capture);
    jobs.put(createJob(captureId, 'push', capture.updatedAt, { revision: capture.contentRevision }));
    await transactionDone(transaction);
    return clone(capture);
  } catch (error) {
    throw storageError(error);
  }
}

module.exports = {
  requestRecreate,
  resolveRemoteDifference,
};
