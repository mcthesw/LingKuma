'use strict';

const { ContractError } = require('./contracts');
const {
  clone,
  requestResult,
  storageError,
  transactionDone,
} = require('./indexeddb-store');

async function getJobSchedule(repository) {
  try {
    const transaction = repository.database.transaction('jobs', 'readonly');
    const jobs = await requestResult(transaction.objectStore('jobs').getAll());
    await transactionDone(transaction);
    const nextByKind = {};
    for (const job of jobs) {
      const availableAt = Math.max(job.nextAttemptAt, job.leaseUntil || 0);
      nextByKind[job.kind] = Math.min(nextByKind[job.kind] ?? Infinity, availableAt);
    }
    return {
      count: jobs.length,
      nextAttemptAt: jobs.length > 0
        ? Math.min(...jobs.map(job => Math.max(job.nextAttemptAt, job.leaseUntil || 0)))
        : null,
      nextByKind,
    };
  } catch (error) {
    throw storageError(error);
  }
}

async function requeueBlockedPushes(repository, createJob) {
  try {
    const transaction = repository.database.transaction(['captures', 'jobs'], 'readwrite');
    const captures = transaction.objectStore('captures');
    const jobs = transaction.objectStore('jobs');
    const allCaptures = await requestResult(captures.getAll());
    let count = 0;
    for (const capture of allCaptures) {
      if (!capture.active || capture.contentState !== 'ready'
          || capture.link.deliveryState !== 'blocked') {
        continue;
      }
      capture.link.deliveryState = 'pending';
      capture.link.lastError = null;
      capture.updatedAt = repository.now();
      captures.put(capture);
      jobs.put(createJob(capture.captureId, 'push', capture.updatedAt, {
        revision: capture.contentRevision,
      }));
      count += 1;
    }
    await transactionDone(transaction);
    return count;
  } catch (error) {
    throw storageError(error);
  }
}

async function deferJob(repository, jobId, nextAttemptAt) {
  if (typeof jobId !== 'string' || !Number.isFinite(nextAttemptAt)) {
    throw new ContractError('INPUT_INVALID', 'The deferred job is invalid.');
  }
  try {
    const transaction = repository.database.transaction('jobs', 'readwrite');
    const jobs = transaction.objectStore('jobs');
    const job = await requestResult(jobs.get(jobId));
    if (job && (!job.leaseOwner || !job.leaseUntil || job.leaseUntil <= repository.now())) {
      job.nextAttemptAt = Math.max(job.nextAttemptAt, nextAttemptAt);
      jobs.put(job);
    }
    await transactionDone(transaction);
    return job ? clone(job) : null;
  } catch (error) {
    throw storageError(error);
  }
}

module.exports = {
  deferJob,
  getJobSchedule,
  requeueBlockedPushes,
};
