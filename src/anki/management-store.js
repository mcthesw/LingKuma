'use strict';

const { clone, requestResult, storageError, transactionDone } = require('./indexeddb-store');
const { ContractError } = require('./contracts');
const { deriveCaptureStatus } = require('./capture-status');

const MANAGEMENT_STATES = Object.freeze([
  'waiting_content', 'content_failed', 'waiting_setup', 'waiting_anki',
  'synced', 'conflict', 'remote_missing', 'blocked', 'excluded',
]);

function searchableText(capture) {
  const source = capture.content?.source || {};
  return [
    capture.content?.term,
    capture.content?.contextText,
    capture.content?.meaning,
    capture.content?.reading,
    capture.content?.usage,
    capture.content?.userNote,
    source.title,
    source.locator,
    source.url,
  ].filter(value => typeof value === 'string').join('\n').toLocaleLowerCase();
}

class ManagementStore {
  constructor(repository) {
    this.repository = repository;
  }

  async list({ query = '', state = null, cursor = null, limit = 30 } = {}) {
    try {
      const transaction = this.repository.database.transaction('captures', 'readonly');
      let captures = await requestResult(transaction.objectStore('captures').getAll());
      await transactionDone(transaction);
      const normalizedQuery = query.trim().toLocaleLowerCase();
      captures = captures
        .filter(capture => !state || deriveCaptureStatus(capture) === state)
        .filter(capture => !normalizedQuery || searchableText(capture).includes(normalizedQuery))
        .sort((left, right) => right.updatedAt - left.updatedAt || left.captureId.localeCompare(right.captureId));
      if (cursor) {
        const index = captures.findIndex(capture => `${capture.updatedAt}:${capture.captureId}` === cursor);
        captures = index < 0 ? [] : captures.slice(index + 1);
      }
      const items = captures.slice(0, limit);
      const last = items.at(-1);
      return {
        items: clone(items),
        nextCursor: captures.length > items.length && last ? `${last.updatedAt}:${last.captureId}` : null,
      };
    } catch (error) {
      throw storageError(error);
    }
  }

  async retry(captureId, expectedRevision) {
    try {
      const transaction = this.repository.database.transaction(['captures', 'jobs'], 'readwrite');
      const captures = transaction.objectStore('captures');
      const jobs = transaction.objectStore('jobs');
      const capture = await requestResult(captures.get(captureId));
      if (!capture || capture.contentRevision !== expectedRevision) {
        throw new ContractError('STALE_REVISION', 'The capture changed before retry.');
      }
      if (!capture.active) throw new ContractError('INPUT_INVALID', 'Resume this capture before retrying.');
      const now = this.repository.now();
      const enqueue = (kind, generation = capture.enrichmentGeneration) => jobs.put({
        jobId: `${captureId}:${kind}`, captureId, kind,
        requestedRevision: capture.contentRevision, generation,
        attemptCount: 0, nextAttemptAt: now, leaseOwner: null, leaseUntil: null, lastError: null,
      });
      if (capture.contentState === 'failed') {
        capture.enrichmentGeneration += 1;
        capture.contentState = 'pending';
        enqueue('enrich', capture.enrichmentGeneration);
      } else if (capture.link.deliveryState === 'blocked'
          || (capture.link.deliveryState === 'conflict' && !capture.link.observedRemoteFields)) {
        capture.link.deliveryState = 'pending';
        capture.link.lastError = null;
        enqueue('push');
      } else if (['failed', 'unavailable'].includes(capture.mediaState)) {
        capture.mediaState = 'pending';
        delete capture.mediaError;
        enqueue('media');
      } else {
        throw new ContractError('INPUT_INVALID', 'This capture has no retryable failure.');
      }
      capture.updatedAt = now;
      captures.put(capture);
      await transactionDone(transaction);
      return clone(capture);
    } catch (error) {
      throw storageError(error);
    }
  }
}

module.exports = { MANAGEMENT_STATES, ManagementStore, searchableText };
