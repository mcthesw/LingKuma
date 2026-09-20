'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const { ContractError } = require('../../../src/anki/contracts');
const { EnrichmentCoordinator } = require('../../../src/anki/enrichment');
const { openAnkiRepository } = require('../../../src/anki/repository');

let sequence = 0;
function databaseName(label) {
  sequence += 1;
  return `lingkuma-enrichment-${label}-${sequence}`;
}

function snapshot(term = 'yields', contextText = 'The iterator yields each record.') {
  const targetStart = contextText.indexOf(term);
  return {
    language: 'en',
    term,
    contextText,
    targetStart,
    targetEnd: targetStart + term.length,
    contextQuality: 'sentence',
    fallbackSourceKey: '',
    source: { kind: 'web', url: 'https://example.test/article', title: 'Article' },
  };
}

function explanation(meaning) {
  return { meaning, sentenceTranslation: '', reading: '', usage: '' };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for asynchronous test state.');
}

test('ten duplicate lookups persist one job and invoke the provider once', async () => {
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('duplicate'), now: () => 100 });
  const created = await Promise.all(Array.from({ length: 10 }, () => repository.createOrGetCapture(snapshot())));
  let providerCalls = 0;
  const notifications = [];
  const worker = new EnrichmentCoordinator({
    repository,
    provider: { explainInContext: async () => { providerCalls += 1; return explanation('产生'); } },
    notifyCaptureChanged: dto => notifications.push(dto),
    now: () => 100,
  });
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    worker.processNext({ ownerToken: `worker-${index}`, at: 100 })));
  await Promise.resolve();

  assert.equal(created.filter(result => result.created).length, 1);
  assert.equal(providerCalls, 1);
  assert.equal(results.filter(result => result.status === 'committed').length, 1);
  assert.equal(results.filter(result => result.status === 'idle').length, 9);
  const capture = await repository.getCapture(created[0].capture.captureId);
  assert.equal(capture.content.meaning, '产生');
  assert.equal(capture.contentState, 'ready');
  assert.equal(capture.contentRevision, 1);
  assert.equal(notifications.at(-1).content.meaning, capture.content.meaning);
  assert.equal((await repository.claimDueJob('push', 100, 'push-worker')).requestedRevision, 1);
  repository.close();
});

test('the same claimed generation is single-flight inside one worker', async () => {
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('flight'), now: () => 10 });
  await repository.createOrGetCapture(snapshot());
  const job = await repository.claimDueJob('enrich', 10, 'worker');
  const response = deferred();
  let calls = 0;
  const worker = new EnrichmentCoordinator({
    repository,
    provider: { explainInContext: () => { calls += 1; return response.promise; } },
  });
  const first = worker.processClaimedJob(job);
  const second = worker.processClaimedJob(job);
  assert.strictEqual(first, second);
  response.resolve(explanation('生成'));
  assert.equal((await first).status, 'committed');
  assert.equal(calls, 1);
  repository.close();
});

test('A and B may finish out of order without crossing capture identity', async () => {
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('ordering'), now: () => 20 });
  const a = await repository.createOrGetCapture(snapshot('alpha', 'An alpha appears here.'));
  const b = await repository.createOrGetCapture(snapshot('beta', 'A beta appears here.'));
  const firstJob = await repository.claimDueJob('enrich', 20, 'worker-1');
  const secondJob = await repository.claimDueJob('enrich', 20, 'worker-2');
  const responses = new Map();
  const worker = new EnrichmentCoordinator({
    repository,
    provider: {
      explainInContext: input => {
        const response = deferred();
        responses.set(input.term, response);
        return response.promise;
      },
    },
  });
  const first = worker.processClaimedJob(firstJob);
  const second = worker.processClaimedJob(secondJob);
  await waitFor(() => responses.size === 2);
  responses.get('beta').resolve(explanation('乙'));
  responses.get('alpha').resolve(explanation('甲'));
  await Promise.all([first, second]);

  assert.equal((await repository.getCapture(a.capture.captureId)).content.meaning, '甲');
  assert.equal((await repository.getCapture(b.capture.captureId)).content.meaning, '乙');
  repository.close();
});

test('persisted work survives UI absence and repository restart', async () => {
  const name = databaseName('restart');
  let repository = await openAnkiRepository({ indexedDB, name, now: () => 30 });
  const { capture } = await repository.createOrGetCapture(snapshot());
  repository.close();

  repository = await openAnkiRepository({ indexedDB, name, now: () => 40 });
  const worker = new EnrichmentCoordinator({
    repository,
    provider: { explainInContext: async () => explanation('重启后完成') },
    now: () => 40,
  });
  assert.equal((await worker.processNext({ ownerToken: 'restarted', at: 40 })).status, 'committed');
  assert.equal((await repository.getCapture(capture.captureId)).content.meaning, '重启后完成');
  repository.close();
});

test('manual edits and regeneration invalidate late provider results', async () => {
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('stale'), now: () => 50 });
  const { capture } = await repository.createOrGetCapture(snapshot());
  const oldJob = await repository.claimDueJob('enrich', 50, 'old-worker');
  const oldResponse = deferred();
  const worker = new EnrichmentCoordinator({
    repository,
    provider: { explainInContext: () => oldResponse.promise },
  });
  const pending = worker.processClaimedJob(oldJob);
  await Promise.resolve();
  const edited = await repository.patchContent(capture.captureId, 0, { meaning: '人工释义' });
  oldResponse.resolve(explanation('迟到释义'));
  assert.equal((await pending).status, 'stale');
  assert.equal((await repository.getCapture(capture.captureId)).content.meaning, '人工释义');
  assert.equal((await repository.claimDueJob('push', 50, 'push-after-edit')).requestedRevision, edited.contentRevision);

  const regenerated = await repository.requestRegeneration(capture.captureId, edited.contentRevision);
  const generationTwo = await repository.claimDueJob('enrich', 50, 'generation-two');
  const responseTwo = deferred();
  const responseThree = deferred();
  let providerCall = 0;
  const regenerationWorker = new EnrichmentCoordinator({
    repository,
    provider: { explainInContext: () => (++providerCall === 1 ? responseTwo.promise : responseThree.promise) },
  });
  const oldGeneration = regenerationWorker.processClaimedJob(generationTwo);
  await Promise.resolve();
  const newest = await repository.requestRegeneration(capture.captureId, regenerated.contentRevision);
  responseTwo.resolve(explanation('旧一代'));
  assert.equal((await oldGeneration).status, 'stale');
  const generationThree = await repository.claimDueJob('enrich', 50, 'generation-three');
  const newestPending = regenerationWorker.processClaimedJob(generationThree);
  responseThree.resolve(explanation('新一代'));
  assert.equal((await newestPending).status, 'committed');
  const finalCapture = await repository.getCapture(capture.captureId);
  assert.equal(finalCapture.enrichmentGeneration, newest.enrichmentGeneration);
  assert.equal(finalCapture.content.meaning, '新一代');
  repository.close();
});

test('retryable failures back off finitely and recover without losing original context', async () => {
  let clock = 100;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('retry'), now: () => clock });
  const { capture } = await repository.createOrGetCapture(snapshot());
  let calls = 0;
  const worker = new EnrichmentCoordinator({
    repository,
    provider: {
      explainInContext: async () => {
        calls += 1;
        if (calls < 3) {
          throw new ContractError('EXPLANATION_UNAVAILABLE', 'offline', { retryable: true });
        }
        return explanation('最终成功');
      },
    },
    now: () => clock,
  });
  assert.deepEqual(
    { status: (await worker.processNext({ ownerToken: 'attempt-1', at: clock })).status, calls },
    { status: 'rescheduled', calls: 1 },
  );
  clock = 1_099;
  assert.equal((await worker.processNext({ ownerToken: 'too-early', at: clock })).status, 'idle');
  clock = 1_100;
  assert.equal((await worker.processNext({ ownerToken: 'attempt-2', at: clock })).status, 'rescheduled');
  clock = 6_100;
  assert.equal((await worker.processNext({ ownerToken: 'attempt-3', at: clock })).status, 'committed');
  const recovered = await repository.getCapture(capture.captureId);
  assert.equal(recovered.content.meaning, '最终成功');
  assert.equal(recovered.content.contextText, snapshot().contextText);
  assert.equal(calls, 3);
  repository.close();
});

test('permanently invalid output never queues a blank card and explicit regeneration recovers', async () => {
  let clock = 200;
  const repository = await openAnkiRepository({ indexedDB, name: databaseName('failed'), now: () => clock });
  const { capture } = await repository.createOrGetCapture(snapshot());
  const failing = new EnrichmentCoordinator({
    repository,
    provider: {
      explainInContext: async () => {
        throw new ContractError('EXPLANATION_UNAVAILABLE', 'invalid output', { retryable: true });
      },
    },
    now: () => clock,
    retryDelaysMs: [1, 1],
  });
  assert.equal((await failing.processNext({ ownerToken: 'fail-1', at: clock })).status, 'rescheduled');
  clock += 1;
  assert.equal((await failing.processNext({ ownerToken: 'fail-2', at: clock })).status, 'rescheduled');
  clock += 1;
  assert.equal((await failing.processNext({ ownerToken: 'fail-3', at: clock })).status, 'failed');
  const failed = await repository.getCapture(capture.captureId);
  assert.equal(failed.contentState, 'failed');
  assert.equal(failed.content.meaning, '');
  assert.equal((await repository.claimDueJob('push', clock, 'must-not-push')), null);

  await repository.requestRegeneration(capture.captureId, failed.contentRevision);
  const recovery = new EnrichmentCoordinator({
    repository,
    provider: { explainInContext: async () => explanation('恢复成功') },
    now: () => clock,
  });
  assert.equal((await recovery.processNext({ ownerToken: 'recover', at: clock })).status, 'committed');
  assert.equal((await repository.getCapture(capture.captureId)).content.meaning, '恢复成功');
  repository.close();
});
