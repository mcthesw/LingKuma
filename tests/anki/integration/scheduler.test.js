'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { EnrichmentCoordinator } = require('../../../src/anki/enrichment');
const { openAnkiRepository } = require('../../../src/anki/repository');
const {
  ANKI_ALARM_NAME,
  ANKI_BACKOFF_KEY,
  JobScheduler,
  BrowserAlarmClock,
  installSchedulerRuntime,
} = require('../../../src/anki/scheduler');

let sequence = 0;
function databaseName(label) {
  sequence += 1;
  return `lingkuma-scheduler-${label}-${sequence}`;
}

function snapshot(index) {
  const term = `term${index}`;
  const contextText = `Context contains ${term} here.`;
  const targetStart = contextText.indexOf(term);
  return {
    language: 'en',
    term,
    contextText,
    targetStart,
    targetEnd: targetStart + term.length,
    contextQuality: 'sentence',
    fallbackSourceKey: '',
    source: { kind: 'web', url: `https://example.test/${index}`, title: `Page ${index}` },
  };
}

function readyDefaults() {
  return {
    content: { meaning: 'meaning' },
    destination: {
      expectedProfile: 'User 1',
      deckName: 'LingKuma',
      modelName: 'LingKuma Lookup v1',
    },
  };
}

class FakeAlarmClock {
  constructor() {
    this.alarms = new Map();
    this.created = [];
    this.cleared = [];
  }

  async get(name) {
    return this.alarms.get(name) || null;
  }

  async create(name, when) {
    const alarm = { name, scheduledTime: when };
    this.alarms.set(name, alarm);
    this.created.push(alarm);
  }

  async clear(name) {
    this.cleared.push(name);
    return this.alarms.delete(name);
  }
}

function idleEnrichment() {
  return { processNext: async () => ({ status: 'idle' }) };
}

async function enqueueReady(repository, count) {
  for (let index = 0; index < count; index += 1) {
    await repository.createOrGetCapture(snapshot(index), readyDefaults());
  }
}

test('browser alarm adapter supports callback-style extension APIs', async () => {
  const alarms = new Map();
  const api = {
    alarms: {
      get(name, callback) {
        callback(alarms.get(name));
      },
      create(name, info) {
        alarms.set(name, { name, scheduledTime: info.when });
      },
      clear(name, callback) {
        callback(alarms.delete(name));
      },
    },
  };
  const clock = new BrowserAlarmClock(api);
  await clock.create(ANKI_ALARM_NAME, 1234);
  assert.equal((await clock.get(ANKI_ALARM_NAME)).scheduledTime, 1234);
  assert.equal(await clock.clear(ANKI_ALARM_NAME), true);
  assert.equal(await clock.get(ANKI_ALARM_NAME), null);
});

test('enrichment runs at two-wide concurrency and reclaims an expired lease after worker restart', async () => {
  let clock = 1_000;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('enrich'), now: () => clock });
  for (let index = 0; index < 5; index += 1) {
    await repository.createOrGetCapture(snapshot(index));
  }
  await repository.claimDueJob('enrich', clock, 'dead-worker', 5);
  clock += 6;
  let active = 0;
  let maximumActive = 0;
  const provider = {
    async explainInContext() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return { meaning: 'generated', sentenceTranslation: '', reading: '', usage: '' };
    },
  };
  const enrichmentCoordinator = new EnrichmentCoordinator({
    repository,
    provider,
    now: () => clock,
  });
  const scheduler = new JobScheduler({
    repository,
    enrichmentCoordinator,
    syncService: {
      async processClaimedJob(job) {
        await repository.commitJobResult(
          { jobId: job.jobId, ownerToken: job.leaseOwner },
          job.generation,
        );
        return { status: 'committed' };
      },
    },
    alarmClock: new FakeAlarmClock(),
    now: () => clock,
    createOwner: () => 'scheduler',
  });

  const result = await scheduler.start();
  assert.equal(result.processed, 10);
  assert.equal(maximumActive, 2);
  assert.equal((await repository.getJobSchedule()).count, 0);
  for (let index = 0; index < 5; index += 1) {
    const identity = await repository.createOrGetCapture(snapshot(index));
    assert.equal(identity.capture.contentState, 'ready');
  }
  repository.close();
});

test('one offline failure applies durable global backoff to a large queue and recovery drains in batches', async () => {
  let clock = 10_000;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('offline'), now: () => clock });
  await enqueueReady(repository, 500);
  const alarms = new FakeAlarmClock();
  let online = false;
  let calls = 0;
  let activeWrites = 0;
  let maximumWrites = 0;
  const syncService = {
    async processClaimedJob(job) {
      calls += 1;
      activeWrites += 1;
      maximumWrites = Math.max(maximumWrites, activeWrites);
      const token = { jobId: job.jobId, ownerToken: job.leaseOwner };
      if (!online) {
        await repository.rescheduleJob(token, { nextAttemptAt: clock + 5_000, lastError: null });
        activeWrites -= 1;
        return { status: 'retry_scheduled', error: { code: 'ANKI_UNREACHABLE', retryable: true } };
      }
      await repository.commitJobResult(token, job.generation);
      activeWrites -= 1;
      return { status: 'committed' };
    },
  };
  let scheduler = new JobScheduler({
    repository,
    enrichmentCoordinator: idleEnrichment(),
    syncService,
    alarmClock: alarms,
    now: () => clock,
    createOwner: () => 'scheduler-a',
    maxJobsPerBatch: 20,
  });

  const offline = await scheduler.start();
  assert.equal(offline.processed, 1);
  assert.equal(calls, 1);
  assert.deepEqual(await repository.getMeta(ANKI_BACKOFF_KEY), {
    attempt: 1,
    nextAttemptAt: clock + 60_000,
    blockedCode: null,
  });
  assert.equal(alarms.alarms.get(ANKI_ALARM_NAME).scheduledTime, clock + 60_000);

  alarms.alarms.clear();
  scheduler = new JobScheduler({
    repository,
    enrichmentCoordinator: idleEnrichment(),
    syncService,
    alarmClock: alarms,
    now: () => clock,
    createOwner: () => 'scheduler-b',
    maxJobsPerBatch: 20,
  });
  await scheduler.start();
  assert.equal(calls, 1);
  assert.equal(alarms.alarms.get(ANKI_ALARM_NAME).scheduledTime, clock + 60_000);

  online = true;
  clock += 60_000;
  for (let batch = 0; batch < 25; batch += 1) {
    await scheduler.scheduleDrain('alarm');
  }
  assert.equal(calls, 501);
  assert.equal(maximumWrites, 1);
  assert.equal((await repository.getJobSchedule()).count, 0);
  assert.equal(await repository.getMeta(ANKI_BACKOFF_KEY), null);
  repository.close();
});

test('shared configuration failures stop the queue and settings repair resumes blocked work', async () => {
  let clock = 20_000;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('blocked'), now: () => clock });
  await enqueueReady(repository, 4);
  const alarms = new FakeAlarmClock();
  let configured = false;
  let calls = 0;
  const syncService = {
    async processClaimedJob(job) {
      calls += 1;
      const token = { jobId: job.jobId, ownerToken: job.leaseOwner };
      if (!configured) {
        await repository.commitJobResult(token, job.generation, {
          linkPatch: {
            deliveryState: 'blocked',
            lastError: { code: 'AUTH_FAILED', retryable: false },
          },
        });
        return { status: 'blocked', error: { code: 'AUTH_FAILED', retryable: false } };
      }
      await repository.commitJobResult(token, job.generation, {
        linkPatch: { deliveryState: 'synced', lastError: null },
      });
      return { status: 'committed' };
    },
  };
  const scheduler = new JobScheduler({
    repository,
    enrichmentCoordinator: idleEnrichment(),
    syncService,
    alarmClock: alarms,
    now: () => clock,
    createOwner: () => 'scheduler',
  });

  await scheduler.start();
  assert.equal(calls, 1);
  assert.equal((await repository.getJobSchedule()).count, 3);
  assert.equal((await repository.getMeta(ANKI_BACKOFF_KEY)).blockedCode, 'AUTH_FAILED');
  assert.equal(alarms.alarms.has(ANKI_ALARM_NAME), false);

  configured = true;
  await scheduler.settingsRepaired();
  assert.equal(calls, 5);
  assert.equal((await repository.getJobSchedule()).count, 0);
  const captures = await repository.listCaptures({ limit: 10 });
  assert.equal(captures.items.every(capture => capture.link.deliveryState === 'synced'), true);
  repository.close();
});

test('runtime installation registers wake listeners synchronously and remains idempotent', async () => {
  const alarmListeners = [];
  const startupListeners = [];
  const browserApi = {
    alarms: { onAlarm: { addListener: listener => alarmListeners.push(listener) } },
    runtime: { onStartup: { addListener: listener => startupListeners.push(listener) } },
  };
  const calls = [];
  const scheduler = {
    alarmName: ANKI_ALARM_NAME,
    start: async () => { calls.push('start'); },
    scheduleDrain: async reason => { calls.push(reason || 'drain'); },
    ensureWakeup: async () => { calls.push('ensure'); },
    settingsRepaired: async () => { calls.push('repair'); },
  };
  const scope = {};
  const first = installSchedulerRuntime({ browserApi, scheduler, scope });
  const second = installSchedulerRuntime({ browserApi, scheduler, scope });
  assert.equal(first, second);
  assert.equal(alarmListeners.length, 1);
  assert.equal(startupListeners.length, 1);
  await Promise.resolve();
  assert.deepEqual(calls, ['start']);

  alarmListeners[0]({ name: 'unrelated' });
  alarmListeners[0]({ name: ANKI_ALARM_NAME });
  startupListeners[0]();
  await Promise.resolve();
  assert.equal(calls.includes('alarm'), true);
  assert.equal(calls.filter(call => call === 'start').length, 2);
  await first.onManagementOpened();
  await first.onSettingsRepaired();
  assert.equal(calls.includes('management_opened'), true);
  assert.equal(calls.includes('repair'), true);
});
