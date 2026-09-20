'use strict';

const { ContractError } = require('./contracts');
const { toPublicCaptureDto } = require('./capture-service');
const BLOCKING_ANKI_CODES = new Set(['AUTH_FAILED', 'API_UNSUPPORTED', 'DECK_MISSING', 'MODEL_INCOMPATIBLE', 'PROFILE_MISMATCH']);

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const FORMAT_BY_MIME = Object.freeze({
  'audio/mpeg': { extension: 'mp3', header: bytes => (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) },
  'audio/mp3': { extension: 'mp3', header: bytes => (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) },
  'audio/wav': { extension: 'wav', header: bytes => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE' },
  'audio/x-wav': { extension: 'wav', header: bytes => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE' },
  'audio/ogg': { extension: 'ogg', header: bytes => ascii(bytes, 0, 4) === 'OggS' },
});

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function validateAudio(result) {
  const bytes = result?.bytes instanceof Uint8Array ? result.bytes : null;
  const mime = String(result?.mime || '').toLowerCase();
  const format = FORMAT_BY_MIME[mime];
  if (!bytes?.length || bytes.length > MAX_MEDIA_BYTES || !format || !format.header(bytes)) {
    throw new ContractError('AUDIO_FAILED', 'The pronunciation response is not a supported audio file.', { retryable: false });
  }
  return { bytes, mime, extension: format.extension };
}

async function sha256(bytes, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle?.digest) throw new ContractError('AUDIO_FAILED', 'SHA-256 is unavailable.');
  const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

function mediaError(error, retryable = true) {
  return Object.freeze({
    code: error instanceof ContractError ? error.code : 'AUDIO_FAILED',
    message: error instanceof ContractError ? error.message : 'Pronunciation audio could not be attached.',
    retryable: error instanceof ContractError ? error.retryable : retryable,
  });
}

class MediaService {
  constructor({ repository, mediaStore, audioProvider, ankiClient, notifyCaptureChanged = () => {}, now = Date.now, retryDelaysMs = [5_000, 30_000], cryptoApi = globalThis.crypto } = {}) {
    if (!repository || !mediaStore || !audioProvider || !ankiClient) throw new TypeError('Media dependencies are required.');
    Object.assign(this, { repository, mediaStore, audioProvider, ankiClient, notifyCaptureChanged, now, retryDelaysMs, cryptoApi });
  }

  async processClaimedJob(job, { signal } = {}) {
    if (job?.kind !== 'media' || !job.leaseOwner) throw new ContractError('INPUT_INVALID', 'The claimed media job is invalid.');
    const token = { jobId: job.jobId, ownerToken: job.leaseOwner };
    try {
      const capture = await this.repository.getCapture(job.captureId);
      if (!capture || !capture.active || capture.mediaState !== 'pending') return { status: 'stale' };
      if (!capture.link.wasLinked || capture.link.deliveryState !== 'synced') {
        await this.repository.rescheduleJob(token, { nextAttemptAt: this.now() + 1_000, incrementAttempt: false });
        return { status: 'waiting_text' };
      }
      const descriptor = await this.audioProvider.describe(capture);
      if (!descriptor) return this.#terminal(token, 'unavailable', mediaError(new ContractError('AUDIO_UNAVAILABLE', 'The selected word pronunciation channel cannot export audio.', { retryable: false })));
      if (!await this.mediaStore.setClaimedInputKey(token, descriptor.inputKey)) return { status: 'stale' };
      const validated = validateAudio(await this.audioProvider.getWordAudio(capture, descriptor, { signal }));
      const hash = await sha256(validated.bytes, this.cryptoApi);
      const filename = `lk_audio_${hash}.${validated.extension}`;
      let media = await this.mediaStore.get(hash);
      if (!media) media = await this.mediaStore.put({ hash, mime: validated.mime, bytes: validated.bytes, filename, ankiMediaFilename: null });
      if (!media.ankiMediaFilename) {
        await this.ankiClient.getProfileStatus(capture.destination?.expectedProfile || null, { signal });
        const actual = await this.ankiClient.storeMediaFile(filename, base64(validated.bytes), { signal });
        if (typeof actual !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(actual)) throw new ContractError('AUDIO_FAILED', 'AnkiConnect returned an invalid media filename.');
        media = await this.mediaStore.put({ ...media, ankiMediaFilename: actual });
      }
      const currentDescriptor = await this.audioProvider.describe(await this.repository.getCapture(job.captureId));
      if (!currentDescriptor || currentDescriptor.inputKey !== descriptor.inputKey) {
        await this.repository.rescheduleJob(token, { nextAttemptAt: this.now(), incrementAttempt: false });
        return { status: 'stale_input' };
      }
      const finalized = await this.mediaStore.finalize(token, descriptor.inputKey, media);
      if (!finalized) return { status: 'stale' };
      this.#notify(finalized);
      return { status: 'committed', capture: toPublicCaptureDto(finalized) };
    } catch (error) {
      const normalized = mediaError(error);
      if (BLOCKING_ANKI_CODES.has(normalized.code)) {
        const result = await this.repository.rescheduleJob(token, {
          nextAttemptAt: this.now(),
          lastError: normalized,
          incrementAttempt: false,
        });
        return { status: result === 'committed' ? 'blocked' : 'stale', error: normalized };
      }
      const attempt = job.attemptCount + 1;
      if (normalized.retryable && attempt <= this.retryDelaysMs.length) {
        const result = await this.repository.rescheduleJob(token, { nextAttemptAt: this.now() + this.retryDelaysMs[attempt - 1], lastError: normalized });
        return { status: result === 'committed' ? 'rescheduled' : 'stale', error: normalized };
      }
      return this.#terminal(token, 'failed', normalized);
    }
  }

  async #terminal(token, state, error) {
    const capture = await this.mediaStore.finishUnavailable(token, state, error);
    if (capture) this.#notify(capture);
    return { status: capture ? state : 'stale', error };
  }

  #notify(capture) {
    Promise.resolve(this.notifyCaptureChanged(toPublicCaptureDto(capture))).catch(() => {});
  }
}

module.exports = { FORMAT_BY_MIME, MAX_MEDIA_BYTES, MediaService, base64, mediaError, sha256, validateAudio };
