'use strict';

const { ANKI_FIELD_NAMES, ContractError } = require('./contracts');
const { isCaptureId } = require('./identity');
const { deriveCaptureStatus } = require('./capture-status');
const { MANAGEMENT_STATES } = require('./management-store');
const { renderFields } = require('./note-model');

function managementDto(capture) {
  const remoteFields = capture.link?.deliveryState === 'conflict' && capture.link.observedRemoteFields
    ? Object.fromEntries(ANKI_FIELD_NAMES.map(name => [name, String(capture.link.observedRemoteFields[name] || '')]))
    : null;
  return Object.freeze({
    captureId: capture.captureId,
    termKey: capture.termKey,
    language: capture.originSnapshot?.language || '',
    content: structuredClone(capture.content),
    localFields: renderFields(capture),
    remoteFields,
    contentRevision: capture.contentRevision,
    active: capture.active,
    status: deriveCaptureStatus(capture),
    mediaState: capture.mediaState,
    mediaError: capture.mediaError ? structuredClone(capture.mediaError) : null,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt,
    lastVerifiedAt: capture.link?.lastVerifiedAt || null,
    lastError: capture.link?.lastError ? structuredClone(capture.link.lastError) : null,
  });
}

function captureIdFrom(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).length !== 1 || !isCaptureId(payload.captureId)) {
    throw new ContractError('INPUT_INVALID', 'Capture command is invalid.');
  }
  return payload.captureId;
}

class ManagementService {
  constructor({ repository, managementStore, captureService, syncService, ankiClient, scheduleDrain = () => {} } = {}) {
    if (!repository || !managementStore || !captureService || !syncService || !ankiClient) {
      throw new TypeError('Management dependencies are required.');
    }
    Object.assign(this, { repository, managementStore, captureService, syncService, ankiClient, scheduleDrain });
  }

  async list(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ContractError('INPUT_INVALID', 'List request is invalid.');
    }
    const allowed = new Set(['query', 'state', 'cursor', 'limit']);
    if (Object.keys(payload).some(key => !allowed.has(key))) throw new ContractError('INPUT_INVALID', 'List request contains unsupported fields.');
    const query = payload.query ?? '';
    const state = payload.state || null;
    const cursor = payload.cursor || null;
    const limit = payload.limit ?? 30;
    if (typeof query !== 'string' || query.length > 256
        || (state && !MANAGEMENT_STATES.includes(state))
        || (cursor !== null && (typeof cursor !== 'string' || cursor.length > 256))
        || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ContractError('INPUT_INVALID', 'List filters are invalid.');
    }
    const result = await this.managementStore.list({ query, state, cursor, limit });
    return Object.freeze({ items: result.items.map(managementDto), nextCursor: result.nextCursor });
  }

  async edit(payload) {
    const result = await this.captureService.edit(payload);
    return managementDto(await this.repository.getCapture(result.captureId));
  }

  async regenerate(payload) {
    const result = await this.captureService.regenerate(payload);
    return managementDto(await this.repository.getCapture(result.captureId));
  }

  async exclude(payload) {
    const result = await this.captureService.exclude(captureIdFrom(payload));
    return managementDto(await this.repository.getCapture(result.captureId));
  }

  async resume(payload) {
    const result = await this.captureService.resume(captureIdFrom(payload));
    return managementDto(await this.repository.getCapture(result.captureId));
  }

  async resolve(payload, options) {
    const result = await this.syncService.resolveConflict(payload, options);
    void Promise.resolve(this.scheduleDrain('conflict_resolved')).catch(() => {});
    return managementDto(await this.repository.getCapture(result.captureId));
  }

  async recreate(payload, options) {
    const result = await this.syncService.recreateMissing(payload, options);
    void Promise.resolve(this.scheduleDrain('missing_recreated')).catch(() => {});
    return managementDto(await this.repository.getCapture(result.captureId));
  }

  async retry(payload, options) {
    if (!payload || !isCaptureId(payload.captureId) || !Number.isInteger(payload.expectedRevision)
        || Object.keys(payload).some(key => !['captureId', 'expectedRevision'].includes(key))) {
      throw new ContractError('INPUT_INVALID', 'Retry request is invalid.');
    }
    const capture = await this.repository.getCapture(payload.captureId);
    if (capture?.link?.deliveryState === 'remote_missing') {
      return this.recreate(payload, options);
    }
    const retried = await this.managementStore.retry(payload.captureId, payload.expectedRevision);
    void Promise.resolve(this.scheduleDrain('capture_retry')).catch(() => {});
    return managementDto(retried);
  }

  async openInAnki(payload, { signal } = {}) {
    const captureId = captureIdFrom(payload);
    const capture = await this.repository.getCapture(captureId);
    if (!capture?.destination || !capture.link?.wasLinked) {
      throw new ContractError('REMOTE_MISSING', 'This capture has no linked Anki note.');
    }
    await this.ankiClient.getProfileStatus(capture.destination.expectedProfile || null, { signal });
    const ids = await this.ankiClient.findNotesByCaptureId(captureId, { signal });
    if (!Array.isArray(ids) || ids.length === 0) throw new ContractError('REMOTE_MISSING', 'The linked Anki note no longer exists.');
    if (ids.length !== 1) throw new ContractError('MULTIPLE_MATCHES', 'Multiple Anki notes have this capture identity.');
    const notes = await this.ankiClient.notesInfo(ids, { signal });
    const note = Array.isArray(notes) && notes.length === 1 ? notes[0] : null;
    if (note?.fields?.CaptureId?.value !== captureId || note.modelName !== capture.destination.modelName) {
      throw new ContractError('IDENTITY_MISMATCH', 'The linked Anki note identity does not match.');
    }
    await this.ankiClient.guiBrowseNote(note.noteId, { signal });
    return Object.freeze({ opened: true });
  }
}

module.exports = { ManagementService, captureIdFrom, managementDto };
