'use strict';

const ANKI_BACKOFF_KEY = 'ankiConnectionBackoffV1';
const ANKI_ALARM_NAME = 'lingkuma-anki-drain-v1';
const DEFAULT_ANKI_BACKOFF_MS = Object.freeze([60_000, 120_000, 300_000, 900_000]);
const BLOCKING_ANKI_CODES = new Set([
  'AUTH_FAILED',
  'API_UNSUPPORTED',
  'MODEL_INCOMPATIBLE',
  'DECK_MISSING',
  'PROFILE_MISMATCH',
]);
const CONNECTIVITY_CODES = new Set(['ANKI_UNREACHABLE', 'TIMEOUT']);

function createOwnerToken() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class BrowserAlarmClock {
  constructor(browserApi) {
    if (!browserApi?.alarms?.get || !browserApi.alarms.create || !browserApi.alarms.clear) {
      throw new TypeError('The browser alarms API is required.');
    }
    this.browserApi = browserApi;
  }

  get(name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = value => {
        if (!settled) {
          settled = true;
          resolve(value || null);
        }
      };
      try {
        const result = this.browserApi.alarms.get(name, finish);
        if (result && typeof result.then === 'function') {
          result.then(finish, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async create(name, when) {
    const result = this.browserApi.alarms.create(name, { when });
    if (result && typeof result.then === 'function') {
      await result;
    }
  }

  clear(name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = value => {
        if (!settled) {
          settled = true;
          resolve(Boolean(value));
        }
      };
      try {
        const result = this.browserApi.alarms.clear(name, finish);
        if (result && typeof result.then === 'function') {
          result.then(finish, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }
}

class JobScheduler {
  #drainPromise = null;
  #ownerSequence = 0;

  constructor({
    repository,
    enrichmentCoordinator,
    syncService,
    alarmClock,
    mediaService = { processClaimedJob: async () => ({ status: 'idle' }) },
    reconciliationService = {
      ensureJobs: async () => 0,
      processClaimedJob: async () => ({ status: 'idle' }),
    },
    now = Date.now,
    monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(),
    createOwner = createOwnerToken,
    maxJobsPerBatch = 20,
    maxBatchMs = 10_000,
    enrichmentConcurrency = 2,
    leaseMs = 30_000,
    ankiBackoffMs = DEFAULT_ANKI_BACKOFF_MS,
    alarmName = ANKI_ALARM_NAME,
    minimumAlarmDelayMs = 250,
  } = {}) {
    if (!repository || !enrichmentCoordinator || !syncService || !alarmClock) {
      throw new TypeError('Repository, coordinators, and alarm clock are required.');
    }
    if (!Number.isInteger(maxJobsPerBatch) || maxJobsPerBatch < 1
        || !Number.isInteger(enrichmentConcurrency) || enrichmentConcurrency < 1
        || !Number.isFinite(maxBatchMs) || maxBatchMs <= 0) {
      throw new TypeError('The scheduler budget is invalid.');
    }
    this.repository = repository;
    this.enrichmentCoordinator = enrichmentCoordinator;
    this.syncService = syncService;
    this.mediaService = mediaService;
    this.reconciliationService = reconciliationService;
    this.alarmClock = alarmClock;
    this.now = now;
    this.monotonicNow = monotonicNow;
    this.createOwner = createOwner;
    this.maxJobsPerBatch = maxJobsPerBatch;
    this.maxBatchMs = maxBatchMs;
    this.enrichmentConcurrency = Math.min(2, enrichmentConcurrency);
    this.leaseMs = leaseMs;
    this.ankiBackoffMs = [...ankiBackoffMs];
    this.alarmName = alarmName;
    this.minimumAlarmDelayMs = minimumAlarmDelayMs;
  }

  start() {
    return this.scheduleDrain('worker_start');
  }

  scheduleDrain() {
    if (!this.#drainPromise) {
      this.#drainPromise = Promise.resolve()
        .then(() => this.#drainBatch())
        .finally(() => {
          this.#drainPromise = null;
        });
    }
    return this.#drainPromise;
  }

  async settingsRepaired() {
    await this.repository.setMeta(ANKI_BACKOFF_KEY, null);
    await this.repository.requeueBlockedPushes();
    return this.scheduleDrain('settings_repaired');
  }

  async ensureWakeup() {
    const schedule = await this.repository.getJobSchedule();
    const backoff = await this.#readBackoff();
    const candidates = [];
    if (Number.isFinite(schedule.nextByKind.enrich)) {
      candidates.push(schedule.nextByKind.enrich);
    }
    if (!backoff.blockedCode && Number.isFinite(schedule.nextByKind.push)) {
      candidates.push(Math.max(schedule.nextByKind.push, backoff.nextAttemptAt || 0));
    }
    if (!backoff.blockedCode && Number.isFinite(schedule.nextByKind.inspect)) {
      candidates.push(Math.max(schedule.nextByKind.inspect, backoff.nextAttemptAt || 0));
    }
    if (!backoff.blockedCode && Number.isFinite(schedule.nextByKind.media)) {
      candidates.push(Math.max(schedule.nextByKind.media, backoff.nextAttemptAt || 0));
    }
    if (candidates.length === 0) {
      await this.alarmClock.clear(this.alarmName);
      return null;
    }
    const now = this.now();
    const when = Math.max(Math.min(...candidates), now + this.minimumAlarmDelayMs);
    const existing = await this.alarmClock.get(this.alarmName);
    if (!existing || existing.scheduledTime !== when) {
      await this.alarmClock.create(this.alarmName, when);
    }
    return when;
  }

  async #drainBatch() {
    const startedAt = this.monotonicNow();
    let processed = 0;
    await this.reconciliationService.ensureJobs();
    processed += await this.#drainEnrichment(startedAt, processed);
    if (this.#hasBudget(startedAt, processed)) {
      processed += await this.#drainAnki(startedAt, processed);
    }
    await this.reconciliationService.ensureJobs();
    const nextWakeAt = await this.ensureWakeup();
    return Object.freeze({ processed, nextWakeAt });
  }

  async #drainEnrichment(startedAt, alreadyProcessed) {
    let processed = 0;
    while (this.#hasBudget(startedAt, alreadyProcessed + processed)) {
      const remaining = this.maxJobsPerBatch - alreadyProcessed - processed;
      const width = Math.min(this.enrichmentConcurrency, remaining);
      const results = await Promise.all(Array.from({ length: width }, () =>
        this.enrichmentCoordinator.processNext({
          ownerToken: this.#nextOwner('enrich'),
          at: this.now(),
          leaseMs: this.leaseMs,
        })));
      const claimed = results.filter(result => result.status !== 'idle').length;
      processed += claimed;
      if (claimed === 0) {
        break;
      }
    }
    return processed;
  }

  async #drainAnki(startedAt, alreadyProcessed) {
    let processed = 0;
    let backoff = await this.#readBackoff();
    if (backoff.blockedCode || (backoff.nextAttemptAt || 0) > this.now()) {
      return processed;
    }
    while (this.#hasBudget(startedAt, alreadyProcessed + processed)) {
      let job = await this.repository.claimDueJob('push', this.now(), this.#nextOwner('push'), this.leaseMs);
      let service = this.syncService;
      if (!job) {
        job = await this.repository.claimDueJob('media', this.now(), this.#nextOwner('media'), this.leaseMs);
        service = this.mediaService;
      }
      if (!job) {
        job = await this.repository.claimDueJob('inspect', this.now(), this.#nextOwner('inspect'), this.leaseMs);
        service = this.reconciliationService;
      }
      if (!job) break;
      const result = await service.processClaimedJob(job);
      processed += 1;
      const code = result.error?.code;
      if (CONNECTIVITY_CODES.has(code)) {
        const attempt = Math.min((backoff.attempt || 0) + 1, this.ankiBackoffMs.length);
        const delay = this.ankiBackoffMs[Math.max(0, attempt - 1)] || 0;
        backoff = { attempt, nextAttemptAt: this.now() + delay, blockedCode: null };
        await this.repository.setMeta(ANKI_BACKOFF_KEY, backoff);
        await this.repository.deferJob(job.jobId, backoff.nextAttemptAt);
        break;
      }
      if (result.status === 'waiting_setup' || BLOCKING_ANKI_CODES.has(code)) {
        backoff = { attempt: 0, nextAttemptAt: null, blockedCode: code || 'DECK_MISSING' };
        await this.repository.setMeta(ANKI_BACKOFF_KEY, backoff);
        break;
      }
      if (result.status !== 'stale' && (backoff.attempt || backoff.nextAttemptAt)) {
        backoff = { attempt: 0, nextAttemptAt: null, blockedCode: null };
        await this.repository.setMeta(ANKI_BACKOFF_KEY, null);
      }
    }
    return processed;
  }

  #hasBudget(startedAt, processed) {
    return processed < this.maxJobsPerBatch
      && this.monotonicNow() - startedAt < this.maxBatchMs;
  }

  #nextOwner(kind) {
    this.#ownerSequence += 1;
    return `${this.createOwner()}:${kind}:${this.#ownerSequence}`;
  }

  async #readBackoff() {
    const value = await this.repository.getMeta(ANKI_BACKOFF_KEY);
    if (!value || typeof value !== 'object') {
      return { attempt: 0, nextAttemptAt: null, blockedCode: null };
    }
    return {
      attempt: Number.isInteger(value.attempt) ? value.attempt : 0,
      nextAttemptAt: Number.isFinite(value.nextAttemptAt) ? value.nextAttemptAt : null,
      blockedCode: typeof value.blockedCode === 'string' ? value.blockedCode : null,
    };
  }
}

function installSchedulerRuntime({ browserApi, scheduler, scope = globalThis } = {}) {
  const stateKey = '__lingkumaAnkiSchedulerV1';
  if (scope[stateKey]) {
    return scope[stateKey];
  }
  if (!browserApi?.alarms?.onAlarm?.addListener || !scheduler) {
    throw new TypeError('Browser alarms and a scheduler are required.');
  }
  const onAlarm = alarm => {
    if (alarm?.name === scheduler.alarmName) {
      void scheduler.scheduleDrain('alarm').catch(() => {});
    }
  };
  browserApi.alarms.onAlarm.addListener(onAlarm);
  const onStartup = () => { void scheduler.start().catch(() => {}); };
  browserApi.runtime?.onStartup?.addListener?.(onStartup);
  const state = Object.freeze({
    ensureWakeup: () => scheduler.ensureWakeup(),
    onAlarm,
    onManagementOpened: () => scheduler.scheduleDrain('management_opened'),
    onSettingsRepaired: () => scheduler.settingsRepaired(),
    scheduleDrain: reason => scheduler.scheduleDrain(reason),
  });
  Object.defineProperty(scope, stateKey, {
    value: state,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  void scheduler.start().catch(() => {});
  return state;
}

module.exports = {
  ANKI_ALARM_NAME,
  ANKI_BACKOFF_KEY,
  BLOCKING_ANKI_CODES,
  BrowserAlarmClock,
  CONNECTIVITY_CODES,
  DEFAULT_ANKI_BACKOFF_MS,
  JobScheduler,
  installSchedulerRuntime,
};
