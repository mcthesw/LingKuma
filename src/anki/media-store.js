'use strict';

const { ContractError } = require('./contracts');
const { clone, requestResult, storageError, transactionDone } = require('./indexeddb-store');

class MediaStore {
  constructor(repository) {
    this.repository = repository;
  }

  async setClaimedInputKey(token, inputKey) {
    try {
      const transaction = this.repository.database.transaction('jobs', 'readwrite');
      const jobs = transaction.objectStore('jobs');
      const job = await requestResult(jobs.get(token.jobId));
      if (!job || job.leaseOwner !== token.ownerToken || job.kind !== 'media') {
        await transactionDone(transaction);
        return false;
      }
      job.inputKey = inputKey;
      jobs.put(job);
      await transactionDone(transaction);
      return true;
    } catch (error) {
      throw storageError(error);
    }
  }

  async get(hash) {
    try {
      const transaction = this.repository.database.transaction('media', 'readonly');
      const value = await requestResult(transaction.objectStore('media').get(hash));
      await transactionDone(transaction);
      return value ? clone(value) : null;
    } catch (error) {
      throw storageError(error);
    }
  }

  async put(value) {
    try {
      const transaction = this.repository.database.transaction('media', 'readwrite');
      transaction.objectStore('media').put(clone(value));
      await transactionDone(transaction);
      return clone(value);
    } catch (error) {
      throw storageError(error);
    }
  }

  async finalize(token, inputKey, media) {
    try {
      const transaction = this.repository.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const job = await requestResult(jobs.get(token.jobId));
      const capture = job ? await requestResult(captures.get(job.captureId)) : null;
      if (!job || !capture || job.leaseOwner !== token.ownerToken || job.inputKey !== inputKey
          || !capture.active || capture.mediaState !== 'pending') {
        await transactionDone(transaction);
        return null;
      }
      capture.mediaState = 'ready';
      capture.mediaHash = media.hash;
      capture.ankiMediaFilename = media.ankiMediaFilename;
      capture.dirtyFields = Array.from(new Set([...(capture.dirtyFields || []), 'Audio'])).sort();
      capture.updatedAt = this.repository.now();
      captures.put(capture);
      jobs.delete(job.jobId);
      const pushId = `${capture.captureId}:push`;
      const previous = await requestResult(jobs.get(pushId));
      jobs.put({
        jobId: pushId,
        captureId: capture.captureId,
        kind: 'push',
        requestedRevision: capture.contentRevision,
        generation: capture.enrichmentGeneration,
        attemptCount: previous?.attemptCount || 0,
        nextAttemptAt: capture.updatedAt,
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
      });
      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }

  async finishUnavailable(token, state, error) {
    if (!['unavailable', 'failed'].includes(state)) {
      throw new ContractError('INPUT_INVALID', 'Invalid terminal media state.');
    }
    try {
      const transaction = this.repository.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const job = await requestResult(jobs.get(token.jobId));
      const capture = job ? await requestResult(captures.get(job.captureId)) : null;
      if (!job || !capture || job.leaseOwner !== token.ownerToken) {
        await transactionDone(transaction);
        return null;
      }
      capture.mediaState = state;
      capture.mediaError = clone(error);
      capture.updatedAt = this.repository.now();
      captures.put(capture);
      jobs.delete(job.jobId);
      await transactionDone(transaction);
      return clone(capture);
    } catch (cause) {
      throw storageError(cause);
    }
  }
}

module.exports = { MediaStore };
