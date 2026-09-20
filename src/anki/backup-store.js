'use strict';

const { clone, requestResult, storageError, transactionDone } = require('./indexeddb-store');

function restoreJob(capture, kind, now) {
  return {
    jobId: `${capture.captureId}:${kind}`,
    captureId: capture.captureId,
    kind,
    requestedRevision: capture.contentRevision,
    generation: capture.enrichmentGeneration,
    attemptCount: 0,
    nextAttemptAt: now,
    leaseOwner: null,
    leaseUntil: null,
    lastError: null,
  };
}

function sameMaterial(left, right) {
  return JSON.stringify({
    originSnapshot: left.originSnapshot,
    content: left.content,
    active: left.active,
  }) === JSON.stringify({
    originSnapshot: right.originSnapshot,
    content: right.content,
    active: right.active,
  });
}

class BackupStore {
  constructor(repository) {
    this.repository = repository;
  }

  async snapshot() {
    try {
      const transaction = this.repository.database.transaction(['captures', 'media'], 'readonly');
      const captures = await requestResult(transaction.objectStore('captures').getAll());
      const media = await requestResult(transaction.objectStore('media').getAll());
      await transactionDone(transaction);
      return { captures: clone(captures), media: clone(media) };
    } catch (error) {
      throw storageError(error);
    }
  }

  async import(validated) {
    try {
      const transaction = this.repository.database.transaction(['captures', 'jobs', 'media'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const mediaStore = transaction.objectStore('media');
      const counts = {
        restored: 0, duplicate: 0, conflict: 0, rejected: 0, mediaRestored: 0,
      };
      for (const incoming of validated.captures) {
        const existing = await requestResult(captures.get(incoming.captureId));
        if (existing) {
          counts[sameMaterial(existing, incoming) ? 'duplicate' : 'conflict'] += 1;
          continue;
        }
        captures.add(clone(incoming));
        if (incoming.active && incoming.link.wasLinked) {
          jobs.put(restoreJob(incoming, 'inspect', this.repository.now()));
        }
        if (incoming.active && incoming.contentState !== 'ready') {
          jobs.put(restoreJob(incoming, 'enrich', this.repository.now()));
        }
        if (incoming.active && incoming.mediaState === 'pending' && incoming.mediaHash) {
          jobs.put(restoreJob(incoming, 'media', this.repository.now()));
        }
        counts.restored += 1;
      }
      for (const media of validated.media) {
        if (await requestResult(mediaStore.get(media.hash))) continue;
        mediaStore.add(clone(media));
        counts.mediaRestored += 1;
      }
      await transactionDone(transaction);
      return Object.freeze(counts);
    } catch (error) {
      throw storageError(error);
    }
  }
}

module.exports = { BackupStore, restoreJob, sameMaterial };
