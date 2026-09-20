'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AnkiConnectClient,
  validateEndpoint,
} = require('../../../src/anki/anki-client');

function response(body, overrides = {}) {
  return {
    ok: true,
    status: 200,
    redirected: false,
    type: 'basic',
    async json() { return body; },
    ...overrides,
  };
}

function sequenceFetch(entries, calls = []) {
  return async (url, options) => {
    calls.push({ url, options, payload: JSON.parse(options.body) });
    const next = entries.shift();
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === 'function' ? next(url, options) : next;
  };
}

test('invoke sends version 6 and optional key while accepting null and extra fields', async () => {
  const calls = [];
  const client = new AnkiConnectClient({
    endpoint: 'http://localhost:8765',
    key: 'secret',
    fetchImpl: sequenceFetch([
      response({ result: null, error: null, future: 'ignored' }),
      response({ result: false, error: null }),
      response({ result: [], error: null }),
    ], calls),
    readRetries: 0,
  });

  assert.equal(await client.addNote({ fields: {} }), null);
  assert.equal(await client.invoke('version'), false);
  assert.deepEqual(await client.deckNames(), []);
  assert.deepEqual(calls[0].payload, {
    action: 'addNote', version: 6, params: { note: { fields: {} } }, key: 'secret',
  });
  assert.equal(calls[0].options.redirect, 'manual');
});

test('native-style fetch transports are invoked with the global receiver', async () => {
  const receivers = [];
  const client = new AnkiConnectClient({
    fetchImpl: function fetchWithRequiredReceiver() {
      receivers.push(this);
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(response({ result: 6, error: null }));
    },
    setTimeoutImpl: function setTimeoutWithRequiredReceiver() {
      receivers.push(this);
      return 1;
    },
    clearTimeoutImpl: function clearTimeoutWithRequiredReceiver() {
      receivers.push(this);
    },
    readRetries: 0,
  });

  assert.equal(await client.version(), 6);
  assert.deepEqual(receivers, [globalThis, globalThis, globalThis]);
});

test('protocol and transport failures receive stable classifications', async t => {
  await t.test('remote error', async () => {
    const client = new AnkiConnectClient({
      fetchImpl: sequenceFetch([response({ result: null, error: 'bad request' })]),
      readRetries: 0,
    });
    await assert.rejects(client.version(), error =>
      error.code === 'ANKI_API_ERROR' && error.details.remoteMessage === 'bad request');
  });

  await t.test('bad JSON', async () => {
    const client = new AnkiConnectClient({
      fetchImpl: sequenceFetch([response(null, { async json() { throw new SyntaxError('bad'); } })]),
      readRetries: 0,
    });
    await assert.rejects(client.version(), error => error.code === 'API_UNSUPPORTED');
  });

  await t.test('HTTP failure', async () => {
    const client = new AnkiConnectClient({
      fetchImpl: sequenceFetch([response(null, { ok: false, status: 403 })]),
      readRetries: 0,
    });
    await assert.rejects(client.version(), error => error.code === 'ANKI_UNREACHABLE' && !error.retryable);
  });

  await t.test('network failure', async () => {
    const client = new AnkiConnectClient({
      fetchImpl: sequenceFetch([new TypeError('offline')]),
      readRetries: 0,
    });
    await assert.rejects(client.version(), error => error.code === 'ANKI_UNREACHABLE' && error.retryable);
  });

  await t.test('timeout', async () => {
    const client = new AnkiConnectClient({
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
      timeoutMs: 5,
      readRetries: 0,
    });
    await assert.rejects(client.version(), error => error.code === 'TIMEOUT' && error.retryable);
  });
});

test('only read calls retry and writes remain single-attempt after unknown results', async () => {
  const readCalls = [];
  const readClient = new AnkiConnectClient({
    fetchImpl: sequenceFetch([
      new TypeError('offline'),
      response({ result: 6, error: null }),
    ], readCalls),
    readRetries: 1,
  });
  assert.equal(await readClient.version(), 6);
  assert.equal(readCalls.length, 2);

  const writeCalls = [];
  const writeClient = new AnkiConnectClient({
    fetchImpl: sequenceFetch([new TypeError('response lost')], writeCalls),
    readRetries: 2,
  });
  await assert.rejects(writeClient.addNote({ fields: {} }), error => error.code === 'ANKI_UNREACHABLE');
  assert.equal(writeCalls.length, 1);
});

test('endpoint validation permits exact loopback origins only', () => {
  assert.equal(validateEndpoint('http://127.0.0.1:8765'), 'http://127.0.0.1:8765/');
  assert.equal(validateEndpoint('https://localhost:8766/'), 'https://localhost:8766/');
  assert.equal(validateEndpoint('http://[::1]:8765'), 'http://[::1]:8765/');
  for (const endpoint of [
    'http://localhost.evil:8765',
    'http://192.168.1.2:8765',
    'http://user:pass@localhost:8765',
    'file:///tmp/anki',
    'http://localhost:8765/proxy',
  ]) {
    assert.throws(() => validateEndpoint(endpoint), error => error.code === 'INPUT_INVALID');
  }
});

test('redirects are rejected without following them', async () => {
  const client = new AnkiConnectClient({
    fetchImpl: sequenceFetch([response(null, { ok: false, status: 302 })]),
    readRetries: 0,
  });
  await assert.rejects(client.version(), error => error.code === 'INPUT_INVALID');
});

test('narrow wrappers reject arbitrary actions, queries and note ids', async () => {
  const client = new AnkiConnectClient({ fetchImpl: sequenceFetch([]), readRetries: 0 });
  await assert.rejects(client.invoke('sync'), error => error.code === 'API_UNSUPPORTED');
  assert.throws(() => client.findNotesByCaptureId('web input'), error => error.code === 'INPUT_INVALID');
  assert.throws(() => client.notesInfo([1, '2']), error => error.code === 'INPUT_INVALID');
});

test('profile protection blocks mismatches and reports unavailable detection', async () => {
  const mismatch = new AnkiConnectClient({
    fetchImpl: sequenceFetch([response({ result: 'Work', error: null })]),
    readRetries: 0,
  });
  await assert.rejects(
    mismatch.getProfileStatus('Personal'),
    error => error.code === 'PROFILE_MISMATCH'
      && error.details.expectedProfile === 'Personal'
      && error.details.activeProfile === 'Work',
  );

  const unsupported = new AnkiConnectClient({
    fetchImpl: sequenceFetch([response({ result: null, error: 'unsupported action getActiveProfile' })]),
    readRetries: 0,
  });
  assert.deepEqual(await unsupported.getProfileStatus('Personal'), {
    supported: false,
    activeProfile: null,
    matches: null,
    warning: 'This AnkiConnect version cannot detect profile changes.',
  });
});
