'use strict';

const { ANKI_FIELD_NAMES, ContractError } = require('./contracts');
const { toPublicCaptureDto } = require('./capture-service');
const { isCaptureId } = require('./identity');
const {
  MODEL_NAME,
  assertCompatibleModelFields,
  assertDeckExists,
  buildAnkiNote,
  renderFields,
} = require('./note-model');

function defaultOperationId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new ContractError('INTERNAL_ERROR', 'Secure operation identifiers are unavailable.');
  }
  return globalThis.crypto.randomUUID();
}

function publicSyncError(error) {
  if (error instanceof ContractError) {
    return Object.freeze({ code: error.code, message: error.message, retryable: error.retryable });
  }
  return Object.freeze({
    code: 'INTERNAL_ERROR',
    message: 'The Anki write coordinator failed.',
    retryable: true,
  });
}

function readNoteFields(noteInfo) {
  if (!noteInfo || !Number.isSafeInteger(noteInfo.noteId) || noteInfo.noteId <= 0
      || !noteInfo.fields || typeof noteInfo.fields !== 'object' || Array.isArray(noteInfo.fields)) {
    throw new ContractError('API_UNSUPPORTED', 'notesInfo returned an invalid note.');
  }
  const fields = {};
  for (const name of ANKI_FIELD_NAMES) {
    const value = noteInfo.fields[name]?.value;
    if (typeof value !== 'string') {
      throw new ContractError('MODEL_INCOMPATIBLE', `The remote note is missing field ${name}.`);
    }
    fields[name] = value;
  }
  return fields;
}

function fieldsEqual(left, right) {
  return ANKI_FIELD_NAMES.every(name => left?.[name] === right?.[name]);
}

function buildDesiredFields(baseFields, renderedFields, dirtyFields) {
  const desired = { ...baseFields };
  for (const name of dirtyFields || []) {
    if (ANKI_FIELD_NAMES.includes(name) && typeof renderedFields[name] === 'string') {
      desired[name] = renderedFields[name];
    }
  }
  return desired;
}

function changedFieldPatch(baseFields, desiredFields, fieldNames) {
  return Object.fromEntries((fieldNames || [])
    .filter(name => ANKI_FIELD_NAMES.includes(name) && baseFields[name] !== desiredFields[name])
    .map(name => [name, desiredFields[name]]));
}

class SyncService {
  constructor({
    repository,
    ankiClient,
    createOperationId = defaultOperationId,
    notifyCaptureChanged = () => {},
    now = Date.now,
    retryDelayMs = 5_000,
  } = {}) {
    if (!repository || !ankiClient) {
      throw new TypeError('repository and ankiClient are required.');
    }
    this.repository = repository;
    this.ankiClient = ankiClient;
    this.createOperationId = createOperationId;
    this.notifyCaptureChanged = notifyCaptureChanged;
    this.now = now;
    this.retryDelayMs = retryDelayMs;
  }

  async resolveConflict({
    captureId,
    expectedRevision,
    strategy,
    localFields = [],
  } = {}, { signal } = {}) {
    if (!isCaptureId(captureId) || !Number.isInteger(expectedRevision)
        || !['remote', 'local', 'fields'].includes(strategy)
        || !Array.isArray(localFields)) {
      throw new ContractError('INPUT_INVALID', 'The conflict resolution request is invalid.');
    }
    const capture = await this.repository.getCapture(captureId);
    if (!capture || capture.contentRevision !== expectedRevision
        || capture.link.deliveryState !== 'conflict' || !capture.link.observedRemoteFields) {
      throw new ContractError('STALE_REVISION', 'The conflict changed before it was resolved.');
    }
    await this.#verifyDestination(capture.destination, signal);
    const located = await this.#locate(capture, signal);
    if (located.kind === 'none') {
      throw new ContractError('REMOTE_MISSING', 'The conflicting Anki note no longer exists.');
    }
    if (located.kind === 'conflict') {
      throw new ContractError(located.code, 'The conflicting Anki identity is not unique.');
    }
    if (!fieldsEqual(located.fields, capture.link.observedRemoteFields)) {
      await this.repository.recordRemoteDifference(captureId, located.fields);
      throw new ContractError('REMOTE_CHANGED', 'The Anki note changed again. Review the latest version.');
    }

    const renderedFields = renderFields(capture);
    let selectedFields;
    if (strategy === 'remote') {
      selectedFields = [];
    } else if (strategy === 'local') {
      selectedFields = ANKI_FIELD_NAMES.filter(name =>
        name !== 'CaptureId' && renderedFields[name] !== located.fields[name]);
    } else {
      const unique = Array.from(new Set(localFields));
      if (unique.some(name => !ANKI_FIELD_NAMES.includes(name) || name === 'CaptureId')) {
        throw new ContractError('INPUT_INVALID', 'The selected conflict fields are invalid.');
      }
      selectedFields = unique.filter(name => renderedFields[name] !== located.fields[name]);
    }
    const resolved = await this.repository.resolveRemoteDifference(
      captureId,
      expectedRevision,
      located.fields,
      located.noteId,
      selectedFields,
    );
    this.#notify(resolved);
    return toPublicCaptureDto(resolved);
  }

  async recreateMissing({ captureId, expectedRevision } = {}, { signal } = {}) {
    if (!isCaptureId(captureId) || !Number.isInteger(expectedRevision)) {
      throw new ContractError('INPUT_INVALID', 'The recreate request is invalid.');
    }
    const capture = await this.repository.getCapture(captureId);
    if (!capture || capture.contentRevision !== expectedRevision
        || capture.link.deliveryState !== 'remote_missing') {
      throw new ContractError('STALE_REVISION', 'The missing-note state changed before recreation.');
    }
    await this.#verifyDestination(capture.destination, signal);
    const located = await this.#locate(capture, signal);
    if (located.kind !== 'none') {
      if (located.kind === 'one') {
        await this.repository.recordRemoteDifference(captureId, located.fields);
      }
      throw new ContractError('REMOTE_CHANGED', 'An Anki note now exists. Review it before recreating.');
    }
    const recreated = await this.repository.requestRecreate(captureId, expectedRevision);
    this.#notify(recreated);
    return toPublicCaptureDto(recreated);
  }

  async processClaimedJob(job, { signal } = {}) {
    if (!job || job.kind !== 'push' || typeof job.jobId !== 'string'
        || typeof job.leaseOwner !== 'string' || !job.leaseOwner
        || !Number.isInteger(job.requestedRevision) || !Number.isInteger(job.generation)) {
      throw new ContractError('INPUT_INVALID', 'The claimed Anki push job is invalid.');
    }
    const token = { jobId: job.jobId, ownerToken: job.leaseOwner };
    try {
      return await this.#run(job, token, signal);
    } catch (error) {
      return this.#handleFailure(job, token, publicSyncError(error));
    }
  }

  async #run(job, token, signal) {
    const capture = await this.repository.getCapture(job.captureId);
    if (!capture || !capture.active || capture.contentState !== 'ready'
        || capture.contentRevision !== job.requestedRevision) {
      return Object.freeze({ status: 'stale', captureId: job.captureId });
    }
    if (!capture.content.meaning.trim()) {
      throw new ContractError('EXPLANATION_UNAVAILABLE', 'A valid meaning is required before writing to Anki.');
    }
    if (!capture.destination) {
      const error = Object.freeze({
        code: 'DECK_MISSING',
        message: 'Anki setup is required before this capture can be written.',
        retryable: false,
      });
      const result = await this.repository.rescheduleJob(token, {
        nextAttemptAt: this.now() + 60_000,
        lastError: error,
        incrementAttempt: false,
      });
      return Object.freeze({
        status: result === 'committed' ? 'waiting_setup' : 'stale',
        captureId: job.captureId,
        error,
      });
    }

    await this.#verifyDestination(capture.destination, signal);
    const renderedFields = renderFields(capture);
    const located = await this.#locate(capture, signal);
    if (located.kind === 'conflict') {
      return this.#locatedConflict(job, token, located);
    }
    if (located.kind === 'none') {
      if (capture.link.wasLinked) {
        return this.#finishWithState(job, token, 'remote_missing', {
          code: 'REMOTE_MISSING',
          message: 'The linked Anki note no longer exists.',
          retryable: false,
        });
      }
      return this.#create(job, token, capture, renderedFields, signal);
    }
    return this.#coordinateExisting(job, token, capture, renderedFields, located, signal);
  }

  async #create(job, token, capture, intendedFields, signal) {
    const opId = this.createOperationId();
    const pending = await this.repository.prepareWrite(
      capture.captureId,
      capture.contentRevision,
      intendedFields,
      null,
      {
        opId,
        kind: 'create',
        jobToken: token,
        submittedFields: capture.dirtyFields,
      },
    );
    if (!pending) {
      return Object.freeze({ status: 'stale', captureId: capture.captureId });
    }

    const note = buildAnkiNote(capture, capture.destination);
    try {
      await this.ankiClient.addNote(note, { signal });
    } catch (writeError) {
      const recovery = await this.#locate(capture, signal);
      const current = await this.repository.getCapture(capture.captureId);
      const recovered = await this.#recoverPending(job, token, current, recovery);
      if (recovered && recovered.status !== 'not_applied') {
        return recovered;
      }
      throw writeError;
    }

    const verification = await this.#locate(capture, signal);
    const current = await this.repository.getCapture(capture.captureId);
    const confirmed = await this.#recoverPending(job, token, current, verification);
    if (confirmed && confirmed.status !== 'not_applied') {
      return confirmed;
    }
    throw new ContractError('ANKI_UNREACHABLE', 'The created Anki note could not be verified.', { retryable: true });
  }

  async #coordinateExisting(job, token, capture, renderedFields, located, signal) {
    const recovered = await this.#recoverPending(job, token, capture, located);
    if (recovered && recovered.status !== 'not_applied') {
      return recovered;
    }

    const baseFields = capture.link.baseFields;
    if (!baseFields) {
      if (!fieldsEqual(located.fields, renderedFields)) {
        return this.#remoteConflict(job, token, located.fields,
          'The existing Anki note differs from local content and has no verified baseline.');
      }
      const prepared = await this.repository.prepareWrite(
        capture.captureId,
        capture.contentRevision,
        renderedFields,
        null,
        {
          opId: this.createOperationId(),
          kind: 'create',
          jobToken: token,
          submittedFields: capture.dirtyFields,
        },
      );
      return prepared
        ? this.#confirm(job, token, prepared.opId, located)
        : Object.freeze({ status: 'stale', captureId: capture.captureId });
    }

    const dirtyFields = [...(capture.dirtyFields || [])];
    const desiredFields = buildDesiredFields(baseFields, renderedFields, dirtyFields);
    if (fieldsEqual(located.fields, desiredFields)) {
      const prepared = await this.repository.prepareWrite(
        capture.captureId,
        capture.contentRevision,
        desiredFields,
        baseFields,
        {
          opId: this.createOperationId(),
          kind: 'update',
          jobToken: token,
          submittedFields: dirtyFields,
        },
      );
      return prepared
        ? this.#confirm(job, token, prepared.opId, located)
        : Object.freeze({ status: 'stale', captureId: capture.captureId });
    }
    if (!fieldsEqual(located.fields, baseFields)) {
      return this.#remoteConflict(job, token, located.fields,
        'The Anki note changed outside LingKuma.');
    }

    const updateFields = changedFieldPatch(baseFields, desiredFields, dirtyFields);
    if (Object.keys(updateFields).length === 0) {
      const prepared = await this.repository.prepareWrite(
        capture.captureId,
        capture.contentRevision,
        desiredFields,
        baseFields,
        {
          opId: this.createOperationId(),
          kind: 'update',
          jobToken: token,
          submittedFields: dirtyFields,
        },
      );
      return prepared
        ? this.#confirm(job, token, prepared.opId, located)
        : Object.freeze({ status: 'stale', captureId: capture.captureId });
    }

    const pending = await this.repository.prepareWrite(
      capture.captureId,
      capture.contentRevision,
      desiredFields,
      baseFields,
      {
        opId: this.createOperationId(),
        kind: 'update',
        jobToken: token,
        submittedFields: dirtyFields,
      },
    );
    if (!pending) {
      return Object.freeze({ status: 'stale', captureId: capture.captureId });
    }

    try {
      await this.ankiClient.updateNoteFields(located.noteId, updateFields, { signal });
    } catch (writeError) {
      const verification = await this.#locate(capture, signal);
      const current = await this.repository.getCapture(capture.captureId);
      const outcome = await this.#recoverPending(job, token, current, verification);
      if (outcome && outcome.status !== 'not_applied') {
        return outcome;
      }
      throw writeError;
    }

    const verification = await this.#locate(capture, signal);
    const current = await this.repository.getCapture(capture.captureId);
    const outcome = await this.#recoverPending(job, token, current, verification);
    if (outcome && outcome.status !== 'not_applied') {
      return outcome;
    }
    throw new ContractError('ANKI_UNREACHABLE', 'The updated Anki note could not be verified.', { retryable: true });
  }

  async #verifyDestination(destination, signal) {
    const modelName = destination.modelName || MODEL_NAME;
    await this.ankiClient.getProfileStatus(destination.expectedProfile, { signal });
    await assertDeckExists(this.ankiClient, destination.deckName);
    assertCompatibleModelFields(await this.ankiClient.modelFieldNames(modelName, { signal }));
  }

  async #locate(capture, signal) {
    const ids = await this.ankiClient.findNotesByCaptureId(capture.captureId, { signal });
    if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id <= 0)
        || new Set(ids).size !== ids.length) {
      throw new ContractError('API_UNSUPPORTED', 'findNotes returned invalid note ids.');
    }
    if (ids.length === 0) {
      return { kind: 'none' };
    }
    const infos = await this.ankiClient.notesInfo(ids, { signal });
    if (!Array.isArray(infos) || infos.length !== ids.length) {
      throw new ContractError('API_UNSUPPORTED', 'notesInfo did not return every requested note.');
    }
    const matches = [];
    for (const info of infos) {
      const fields = readNoteFields(info);
      if (info.modelName !== (capture.destination.modelName || MODEL_NAME)) {
        throw new ContractError('MODEL_INCOMPATIBLE', 'The matching Anki note uses an incompatible note type.');
      }
      if (fields.CaptureId !== capture.captureId) {
        return { kind: 'conflict', code: 'IDENTITY_MISMATCH' };
      }
      matches.push({ noteId: info.noteId, fields });
    }
    if (matches.length !== 1) {
      return { kind: 'conflict', code: 'MULTIPLE_MATCHES', count: matches.length };
    }
    return { kind: 'one', ...matches[0] };
  }

  async #recoverPending(job, token, capture, located) {
    const pending = capture?.link?.pendingWrite;
    if (!pending) {
      return null;
    }
    if (located.kind === 'none') {
      return null;
    }
    if (located.kind === 'conflict') {
      return this.#locatedConflict(job, token, located);
    }
    if (fieldsEqual(located.fields, pending.intendedFields)) {
      return this.#confirm(job, token, pending.opId, located);
    }
    if (pending.kind === 'update' && fieldsEqual(located.fields, pending.previousBase)) {
      return Object.freeze({ status: 'not_applied', captureId: capture.captureId });
    }
    return this.#remoteConflict(job, token, located.fields,
      'The Anki note differs from both the pending write and its verified baseline.');
  }

  #locatedConflict(job, token, located) {
    return this.#finishWithState(job, token, 'conflict', {
      code: located.code,
      message: located.code === 'MULTIPLE_MATCHES'
        ? 'Multiple Anki notes have the same capture identity.'
        : 'Anki returned a note with a different capture identity.',
      retryable: false,
    });
  }

  #remoteConflict(job, token, observedRemoteFields, message) {
    return this.#finishWithState(job, token, 'conflict', {
      code: 'REMOTE_CHANGED',
      message,
      retryable: false,
    }, observedRemoteFields);
  }

  async #confirm(job, token, opId, located) {
    const beforeConfirmation = await this.repository.getCapture(job.captureId);
    if (!beforeConfirmation) {
      return Object.freeze({ status: 'stale', captureId: job.captureId });
    }
    const currentFields = renderFields(beforeConfirmation);
    const capture = await this.repository.confirmWrite(
      opId,
      located.fields,
      located.noteId,
      beforeConfirmation.contentRevision,
      currentFields,
    );
    if (!capture) {
      return Object.freeze({ status: 'stale', captureId: job.captureId });
    }
    const completion = await this.repository.commitJobResult(token, job.generation);
    const current = await this.repository.getCapture(job.captureId);
    this.#notify(current);
    return Object.freeze({
      status: completion === 'committed' ? 'committed' : 'stale',
      capture: toPublicCaptureDto(current),
      noteId: located.noteId,
    });
  }

  async #finishWithState(job, token, deliveryState, error, observedRemoteFields = null) {
    const completion = await this.repository.commitJobResult(token, job.generation, {
      linkPatch: {
        deliveryState,
        lastError: error,
        observedRemoteFields,
      },
    });
    if (completion !== 'committed') {
      return Object.freeze({ status: 'stale', captureId: job.captureId });
    }
    const capture = await this.repository.getCapture(job.captureId);
    this.#notify(capture);
    return Object.freeze({
      status: deliveryState,
      capture: toPublicCaptureDto(capture),
      error,
    });
  }

  async #handleFailure(job, token, error) {
    if (error.retryable) {
      const completion = await this.repository.rescheduleJob(token, {
        nextAttemptAt: this.now() + this.retryDelayMs,
        lastError: error,
      });
      return Object.freeze({
        status: completion === 'committed' ? 'retry_scheduled' : 'stale',
        captureId: job.captureId,
        error,
      });
    }
    return this.#finishWithState(job, token, 'blocked', error);
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
  SyncService,
  defaultOperationId,
  fieldsEqual,
  publicSyncError,
  readNoteFields,
};
