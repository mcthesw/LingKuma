'use strict';

const { ContractError } = require('./contracts');
const { isCaptureId } = require('./identity');

function deriveCaptureStatus(capture) {
  if (!capture.active) {
    return 'excluded';
  }
  if (['conflict', 'remote_missing', 'blocked'].includes(capture.link?.deliveryState)) {
    return capture.link.deliveryState;
  }
  if (capture.contentState === 'failed') {
    return 'content_failed';
  }
  if (capture.contentState !== 'ready') {
    return 'waiting_content';
  }
  if (!capture.destination) {
    return 'waiting_setup';
  }
  if (capture.link?.deliveryState === 'synced' && (capture.dirtyFields || []).length === 0) {
    return 'synced';
  }
  return 'waiting_anki';
}

function toPublicCaptureDto(capture) {
  if (!capture) {
    return null;
  }
  return Object.freeze({
    captureId: capture.captureId,
    termKey: capture.termKey,
    content: structuredClone(capture.content),
    contentState: capture.contentState,
    contentRevision: capture.contentRevision,
    active: capture.active,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt,
    lastSeenAt: capture.lastSeenAt,
    mediaState: capture.mediaState,
    status: deriveCaptureStatus(capture),
    link: Object.freeze({
      deliveryState: capture.link?.deliveryState || 'pending',
      lastVerifiedAt: capture.link?.lastVerifiedAt || null,
      lastError: capture.link?.lastError ? structuredClone(capture.link.lastError) : null,
      hasRemoteDifference: Boolean(capture.link?.observedRemoteFields),
    }),
  });
}

function validateLookupInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContractError('INPUT_INVALID', 'Lookup input is invalid.');
  }
  const keys = Object.keys(input);
  if (keys.some(key => !['lookupSessionId', 'originSnapshot'].includes(key))) {
    throw new ContractError('INPUT_INVALID', 'Lookup input contains unsupported fields.');
  }
  if (typeof input.lookupSessionId !== 'string'
      || input.lookupSessionId.length === 0
      || input.lookupSessionId.length > 128) {
    throw new ContractError('INPUT_INVALID', 'lookupSessionId is invalid.');
  }
  return input;
}

class CaptureService {
  constructor({
    repository,
    getCaptureDefaults = async () => ({}),
    scheduleDrain = () => {},
    notifyCaptureChanged = () => {},
  } = {}) {
    if (!repository) {
      throw new TypeError('repository is required.');
    }
    this.repository = repository;
    this.getCaptureDefaults = getCaptureDefaults;
    this.scheduleDrain = scheduleDrain;
    this.notifyCaptureChanged = notifyCaptureChanged;
  }

  #schedule(capture) {
    Promise.resolve()
      .then(() => this.scheduleDrain(capture.captureId))
      .catch(() => {});
  }

  #notify(capture) {
    const dto = toPublicCaptureDto(capture);
    Promise.resolve()
      .then(() => this.notifyCaptureChanged(dto))
      .catch(() => {});
    return dto;
  }

  async lookup(input) {
    const { lookupSessionId, originSnapshot } = validateLookupInput(input);
    const defaults = await this.getCaptureDefaults();
    const { capture, created } = await this.repository.createOrGetCapture(originSnapshot, defaults || {});
    this.#schedule(capture);
    return Object.freeze({
      lookupSessionId,
      captureId: capture.captureId,
      existing: !created,
      persisted: true,
      capture: toPublicCaptureDto(capture),
    });
  }

  async get(captureId) {
    if (!isCaptureId(captureId)) {
      throw new ContractError('INPUT_INVALID', 'Invalid capture id.');
    }
    return toPublicCaptureDto(await this.repository.getCapture(captureId));
  }

  async edit({ captureId, expectedRevision, patch } = {}) {
    if (!isCaptureId(captureId) || !Number.isInteger(expectedRevision)) {
      throw new ContractError('INPUT_INVALID', 'Edit request is invalid.');
    }
    const capture = await this.repository.patchContent(captureId, expectedRevision, patch);
    this.#schedule(capture);
    return this.#notify(capture);
  }

  async regenerate({ captureId, expectedRevision } = {}) {
    if (!isCaptureId(captureId) || !Number.isInteger(expectedRevision)) {
      throw new ContractError('INPUT_INVALID', 'Regeneration request is invalid.');
    }
    const capture = await this.repository.requestRegeneration(captureId, expectedRevision);
    this.#schedule(capture);
    return this.#notify(capture);
  }

  async exclude(captureId) {
    if (!isCaptureId(captureId)) {
      throw new ContractError('INPUT_INVALID', 'Invalid capture id.');
    }
    return this.#notify(await this.repository.excludeCapture(captureId));
  }

  async resume(captureId) {
    if (!isCaptureId(captureId)) {
      throw new ContractError('INPUT_INVALID', 'Invalid capture id.');
    }
    const capture = await this.repository.resumeCapture(captureId);
    this.#schedule(capture);
    return this.#notify(capture);
  }
}

module.exports = {
  CaptureService,
  deriveCaptureStatus,
  toPublicCaptureDto,
  validateLookupInput,
};
