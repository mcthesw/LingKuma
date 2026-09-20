'use strict';

const { ContractError } = require('./contracts');
const { toPublicCaptureDto } = require('./capture-service');
const { validateExplanation } = require('./provider-adapter');

const GENERATED_ANKI_FIELDS = Object.freeze([
  'Meaning',
  'SentenceTranslation',
  'Reading',
  'Usage',
]);
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1_000, 5_000]);

function explanationInput(capture, meaningLanguage) {
  const snapshot = capture.originSnapshot;
  return {
    term: snapshot.term,
    language: snapshot.language,
    meaningLanguage,
    contextText: snapshot.contextText,
    targetStart: snapshot.targetStart,
    targetEnd: snapshot.targetEnd,
  };
}

function publicJobError(error) {
  const known = error instanceof ContractError;
  return Object.freeze({
    code: known ? error.code : 'EXPLANATION_UNAVAILABLE',
    message: known ? error.message : 'The provider request failed.',
    retryable: known ? error.retryable : true,
  });
}

class EnrichmentCoordinator {
  #inFlight = new Map();

  constructor({
    repository,
    provider,
    getMeaningLanguage = async () => 'zh',
    notifyCaptureChanged = () => {},
    now = Date.now,
    maxAttempts = 3,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  } = {}) {
    if (!repository || typeof provider?.explainInContext !== 'function') {
      throw new TypeError('repository and provider are required.');
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1
        || !Array.isArray(retryDelaysMs) || retryDelaysMs.some(delay => !Number.isFinite(delay) || delay < 0)) {
      throw new TypeError('The enrichment retry policy is invalid.');
    }
    this.repository = repository;
    this.provider = provider;
    this.getMeaningLanguage = getMeaningLanguage;
    this.notifyCaptureChanged = notifyCaptureChanged;
    this.now = now;
    this.maxAttempts = maxAttempts;
    this.retryDelaysMs = [...retryDelaysMs];
  }

  async processNext({ ownerToken, at = this.now(), leaseMs = 30_000, signal } = {}) {
    if (typeof ownerToken !== 'string' || !ownerToken) {
      throw new ContractError('INPUT_INVALID', 'An enrichment owner token is required.');
    }
    const job = await this.repository.claimDueJob('enrich', at, ownerToken, leaseMs);
    if (!job) {
      return Object.freeze({ status: 'idle' });
    }
    return this.processClaimedJob(job, { signal });
  }

  processClaimedJob(job, { signal } = {}) {
    if (!job || job.kind !== 'enrich' || typeof job.jobId !== 'string'
        || typeof job.leaseOwner !== 'string' || !job.leaseOwner
        || !Number.isInteger(job.generation)) {
      return Promise.reject(new ContractError('INPUT_INVALID', 'The claimed enrichment job is invalid.'));
    }
    const flightKey = `${job.captureId}:${job.generation}`;
    const existing = this.#inFlight.get(flightKey);
    if (existing) {
      return existing;
    }
    const operation = this.#run(job, signal).finally(() => {
      if (this.#inFlight.get(flightKey) === operation) {
        this.#inFlight.delete(flightKey);
      }
    });
    this.#inFlight.set(flightKey, operation);
    return operation;
  }

  async #run(job, signal) {
    const token = { jobId: job.jobId, ownerToken: job.leaseOwner };
    const capture = await this.repository.getCapture(job.captureId);
    if (!capture || !capture.active || capture.enrichmentGeneration !== job.generation
        || capture.contentState === 'ready') {
      return Object.freeze({ status: 'stale', captureId: job.captureId });
    }

    try {
      const meaningLanguage = await this.getMeaningLanguage(capture);
      const rawExplanation = await this.provider.explainInContext(
        explanationInput(capture, meaningLanguage),
        { signal },
      );
      const explanation = validateExplanation(rawExplanation);
      const nextRevision = job.requestedRevision + 1;
      const dirtyFields = Array.from(new Set([
        ...(capture.dirtyFields || []),
        ...GENERATED_ANKI_FIELDS,
      ])).sort();
      const commit = await this.repository.commitJobResult(token, job.generation, {
        contentPatch: explanation,
        capturePatch: {
          contentState: 'ready',
          contentRevision: nextRevision,
          dirtyFields,
        },
        linkPatch: { lastError: null },
        enqueueJobs: [{ kind: 'push', revision: nextRevision }],
      });
      if (commit !== 'committed') {
        return Object.freeze({ status: 'stale', captureId: job.captureId });
      }
      const committedCapture = await this.repository.getCapture(job.captureId);
      this.#notify(committedCapture);
      return Object.freeze({
        status: 'committed',
        capture: toPublicCaptureDto(committedCapture),
      });
    } catch (error) {
      return this.#handleFailure(job, token, publicJobError(error));
    }
  }

  async #handleFailure(job, token, error) {
    const attempt = job.attemptCount + 1;
    if (error.retryable && attempt < this.maxAttempts) {
      const delayIndex = Math.min(job.attemptCount, Math.max(0, this.retryDelaysMs.length - 1));
      const delay = this.retryDelaysMs[delayIndex] || 0;
      const nextAttemptAt = this.now() + delay;
      const commit = await this.repository.rescheduleJob(token, {
        nextAttemptAt,
        lastError: error,
      });
      return Object.freeze({
        status: commit === 'committed' ? 'rescheduled' : 'stale',
        captureId: job.captureId,
        attempt,
        nextAttemptAt: commit === 'committed' ? nextAttemptAt : null,
        error,
      });
    }

    const commit = await this.repository.commitJobResult(token, job.generation, {
      capturePatch: { contentState: 'failed' },
      linkPatch: { lastError: error },
    });
    if (commit !== 'committed') {
      return Object.freeze({ status: 'stale', captureId: job.captureId });
    }
    const failedCapture = await this.repository.getCapture(job.captureId);
    this.#notify(failedCapture);
    return Object.freeze({
      status: 'failed',
      capture: toPublicCaptureDto(failedCapture),
      attempt,
      error,
    });
  }

  #notify(capture) {
    if (!capture) {
      return;
    }
    const dto = toPublicCaptureDto(capture);
    Promise.resolve()
      .then(() => this.notifyCaptureChanged(dto))
      .catch(() => {});
  }
}

module.exports = {
  DEFAULT_RETRY_DELAYS_MS,
  EnrichmentCoordinator,
  GENERATED_ANKI_FIELDS,
  explanationInput,
  publicJobError,
};
