'use strict';

const { ContractError } = require('./contracts');
const { toPublicCaptureDto } = require('./capture-service');
const {
  fieldsEqual,
  locateCaptureNote,
  publicSyncError,
  verifyDestination,
} = require('./sync-service');

function inspectionOwner() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class ReconciliationService {
  constructor({ repository, associationStore, ankiClient, notifyCaptureChanged = () => {}, now = Date.now, retryDelayMs = 5_000 } = {}) {
    if (!repository || !associationStore || !ankiClient) {
      throw new TypeError('Reconciliation dependencies are required.');
    }
    Object.assign(this, { repository, associationStore, ankiClient, notifyCaptureChanged, now, retryDelayMs });
  }

  ensureJobs() {
    return this.associationStore.ensureInspectionJobs();
  }

  async inspectNow(captureId, { signal } = {}) {
    const capture = await this.repository.getCapture(captureId);
    if (!capture?.active || !capture.destination || !capture.link?.wasLinked) {
      throw new ContractError('REMOTE_MISSING', 'This capture has no linked Anki note.');
    }
    const job = await this.associationStore.claimNow(captureId, `immediate:${inspectionOwner()}`);
    if (!job) throw new ContractError('STALE_REVISION', 'This capture is already being verified. Retry shortly.');
    const result = await this.processClaimedJob(job, { signal });
    if (result.error && result.status !== 'conflict' && result.status !== 'remote_missing') {
      throw new ContractError(result.error.code, result.error.message, { retryable: result.error.retryable });
    }
    return result.capture || toPublicCaptureDto(await this.repository.getCapture(captureId));
  }

  async processClaimedJob(job, { signal } = {}) {
    if (!job || job.kind !== 'inspect' || typeof job.jobId !== 'string'
        || typeof job.leaseOwner !== 'string' || !job.leaseOwner
        || !Number.isInteger(job.requestedRevision)) {
      throw new ContractError('INPUT_INVALID', 'The claimed inspection job is invalid.');
    }
    const token = { jobId: job.jobId, ownerToken: job.leaseOwner };
    try {
      const capture = await this.repository.getCapture(job.captureId);
      if (!capture || !capture.active || !capture.destination || !capture.link?.wasLinked
          || capture.contentRevision !== job.requestedRevision) {
        const completion = await this.repository.commitJobResult(token, job.generation);
        return Object.freeze({ status: completion === 'committed' ? 'stale' : 'stale', captureId: job.captureId });
      }
      await verifyDestination(this.ankiClient, capture.destination, signal);
      const located = await locateCaptureNote(this.ankiClient, capture, signal);
      let outcome;
      if (located.kind === 'none') {
        outcome = {
          kind: 'missing',
          error: { code: 'REMOTE_MISSING', message: 'The linked Anki note no longer exists.', retryable: false },
        };
      } else if (located.kind === 'conflict') {
        outcome = {
          kind: 'conflict',
          error: {
            code: located.code,
            message: located.code === 'MULTIPLE_MATCHES'
              ? 'Multiple Anki notes have the same capture identity.'
              : 'Anki returned a note with a different capture identity.',
            retryable: false,
          },
        };
      } else if (!capture.link.baseFields || !fieldsEqual(located.fields, capture.link.baseFields)) {
        outcome = {
          kind: 'conflict',
          fields: located.fields,
          error: { code: 'REMOTE_CHANGED', message: 'The Anki note changed outside LingKuma.', retryable: false },
        };
      } else {
        outcome = { kind: 'verified', noteId: located.noteId, fields: located.fields };
      }
      const updated = await this.associationStore.commitInspection(
        token,
        capture.contentRevision,
        outcome,
      );
      if (!updated) return Object.freeze({ status: 'stale', captureId: job.captureId });
      this.#notify(updated);
      return Object.freeze({
        status: outcome.kind === 'verified' ? 'committed' : outcome.kind === 'missing' ? 'remote_missing' : 'conflict',
        capture: toPublicCaptureDto(updated),
        ...(outcome.error ? { error: outcome.error } : {}),
      });
    } catch (error) {
      const publicError = publicSyncError(error);
      const completion = await this.repository.rescheduleJob(token, {
        nextAttemptAt: this.now() + this.retryDelayMs,
        lastError: publicError,
      });
      return Object.freeze({
        status: completion === 'committed' ? (publicError.retryable ? 'retry_scheduled' : 'waiting_setup') : 'stale',
        captureId: job.captureId,
        error: publicError,
      });
    }
  }

  #notify(capture) {
    Promise.resolve().then(() => this.notifyCaptureChanged(toPublicCaptureDto(capture))).catch(() => {});
  }
}

module.exports = { ReconciliationService };
