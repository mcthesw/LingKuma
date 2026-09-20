'use strict';

const { clone, requestResult, storageError, transactionDone } = require('./indexeddb-store');

const INSPECTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

function inspectionJob(capture, when) {
  return {
    jobId: `${capture.captureId}:inspect`,
    captureId: capture.captureId,
    kind: 'inspect',
    requestedRevision: capture.contentRevision,
    generation: 0,
    attemptCount: 0,
    nextAttemptAt: when,
    leaseOwner: null,
    leaseUntil: null,
    lastError: null,
  };
}

class AssociationStore {
  constructor(repository, { intervalMs = INSPECTION_INTERVAL_MS } = {}) {
    if (!repository || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new TypeError('Association store dependencies are required.');
    }
    this.repository = repository;
    this.intervalMs = intervalMs;
  }

  async ensureInspectionJobs() {
    try {
      const transaction = this.repository.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = await requestResult(transaction.objectStore('captures').getAll());
      const jobs = transaction.objectStore('jobs');
      let count = 0;
      for (const capture of captures) {
        if (!capture.active || !capture.destination || !capture.link?.wasLinked) continue;
        const jobId = `${capture.captureId}:inspect`;
        if (await requestResult(jobs.get(jobId))) continue;
        const dueAt = Math.max(this.repository.now(), (capture.link.lastVerifiedAt || 0) + this.intervalMs);
        jobs.put(inspectionJob(capture, dueAt));
        count += 1;
      }
      await transactionDone(transaction);
      return count;
    } catch (error) {
      throw storageError(error);
    }
  }

  async claimNow(captureId, ownerToken, leaseMs = 30_000) {
    try {
      const transaction = this.repository.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const capture = await requestResult(captures.get(captureId));
      const now = this.repository.now();
      if (!capture?.active || !capture.destination || !capture.link?.wasLinked) {
        await transactionDone(transaction);
        return null;
      }
      const jobId = `${captureId}:inspect`;
      const current = await requestResult(jobs.get(jobId));
      if (current?.leaseUntil && current.leaseUntil > now) {
        await transactionDone(transaction);
        return null;
      }
      const job = current || inspectionJob(capture, now);
      job.requestedRevision = capture.contentRevision;
      job.leaseOwner = ownerToken;
      job.leaseUntil = now + leaseMs;
      job.nextAttemptAt = now;
      jobs.put(job);
      await transactionDone(transaction);
      return clone(job);
    } catch (error) {
      throw storageError(error);
    }
  }

  async commitInspection(jobToken, expectedRevision, outcome) {
    try {
      const transaction = this.repository.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const job = await requestResult(jobs.get(jobToken.jobId));
      const capture = job ? await requestResult(captures.get(job.captureId)) : null;
      if (!job || job.leaseOwner !== jobToken.ownerToken || !capture
          || !capture.active || capture.contentRevision !== expectedRevision) {
        if (job?.leaseOwner === jobToken.ownerToken) {
          job.leaseOwner = null;
          job.leaseUntil = null;
          job.nextAttemptAt = this.repository.now();
          jobs.put(job);
        }
        await transactionDone(transaction);
        return null;
      }

      if (outcome.kind === 'verified') {
        const restoredDifference = capture.link.lastError?.code === 'RESTORE_REVIEW_REQUIRED'
          && (capture.dirtyFields || []).length > 0;
        capture.link.noteIdHint = outcome.noteId;
        capture.link.lastVerifiedAt = this.repository.now();
        if (restoredDifference) {
          capture.link.deliveryState = 'conflict';
          capture.link.observedRemoteFields = clone(outcome.fields);
        } else {
          capture.link.lastError = null;
          capture.link.observedRemoteFields = null;
          if (['pending', 'conflict', 'remote_missing'].includes(capture.link.deliveryState)) {
            capture.link.deliveryState = (capture.dirtyFields || []).length > 0 ? 'pending' : 'synced';
          }
        }
      } else if (outcome.kind === 'missing') {
        capture.link.deliveryState = 'remote_missing';
        capture.link.observedRemoteFields = null;
        capture.link.lastError = outcome.error;
        jobs.delete(`${capture.captureId}:push`);
      } else {
        capture.link.deliveryState = 'conflict';
        capture.link.observedRemoteFields = outcome.fields ? clone(outcome.fields) : null;
        capture.link.lastError = outcome.error;
        jobs.delete(`${capture.captureId}:push`);
      }
      capture.updatedAt = this.repository.now();
      captures.put(capture);
      job.requestedRevision = capture.contentRevision;
      job.attemptCount = 0;
      job.nextAttemptAt = this.repository.now() + this.intervalMs;
      job.leaseOwner = null;
      job.leaseUntil = null;
      job.lastError = null;
      jobs.put(job);
      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }
}

module.exports = { AssociationStore, INSPECTION_INTERVAL_MS };
