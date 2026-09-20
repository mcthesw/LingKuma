'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requireContentSender } = require('../../../src/anki/background-runtime');
const { toPublicCaptureDto } = require('../../../src/anki/capture-service');
const { publicSettings, requireTrustedManagement } = require('../../../src/anki/setup-service');

const browserApi = {
  runtime: {
    id: 'extension-id',
    getURL(path = '') { return `chrome-extension://extension-id/${String(path).replace(/^\//, '')}`; },
  },
};

test('A47 management and content routes enforce distinct sender capabilities', () => {
  let managementCalls = 0;
  const management = requireTrustedManagement(() => { managementCalls += 1; return 'managed'; }, browserApi);
  for (const sender of [
    { id: 'extension-id', tab: { id: 1 }, url: 'https://article.test/' },
    { id: 'foreign-extension', url: 'chrome-extension://extension-id/src/anki/manager.html' },
    { id: 'extension-id', url: 'chrome-extension://extension-id/src/anki/content.js' },
  ]) {
    assert.throws(() => management({}, { sender }), error => error.code === 'FORBIDDEN');
  }
  assert.equal(management({}, {
    sender: { id: 'extension-id', url: 'chrome-extension://extension-id/src/anki/manager.html' },
  }), 'managed');
  assert.equal(managementCalls, 1);

  let contentCalls = 0;
  const content = requireContentSender(() => { contentCalls += 1; return 'captured'; }, browserApi);
  assert.throws(
    () => content({}, { sender: { id: 'extension-id', url: 'chrome-extension://extension-id/src/anki/manager.html' } }),
    error => error.code === 'FORBIDDEN',
  );
  assert.throws(
    () => content({}, { sender: { id: 'foreign-extension', tab: { id: 2 } } }),
    error => error.code === 'FORBIDDEN',
  );
  assert.equal(content({}, { sender: { id: 'extension-id', tab: { id: 2 }, frameId: 0 } }), 'captured');
  assert.equal(contentCalls, 1);
});

test('public settings and capture DTOs omit credentials and internal association data', () => {
  const settings = publicSettings({
    configured: true,
    endpoint: 'http://127.0.0.1:8765/',
    apiKey: 'top-secret',
    deckName: 'LingKuma',
    learningLanguage: 'en',
    meaningLanguage: 'zh',
    autoCaptureEnabled: true,
    attachAudio: true,
    expectedProfile: 'User 1',
    profileDetectionSupported: true,
    profileWarning: null,
  });
  assert.equal(settings.hasApiKey, true);
  assert.equal(JSON.stringify(settings).includes('top-secret'), false);
  assert.equal(Object.hasOwn(settings, 'apiKey'), false);

  const dto = toPublicCaptureDto({
    captureId: `lk1_${'a'.repeat(64)}`,
    termKey: 'en\0term',
    content: { term: 'term', meaning: 'meaning' },
    contentState: 'ready',
    contentRevision: 2,
    active: true,
    createdAt: 1,
    updatedAt: 2,
    lastSeenAt: 2,
    mediaState: 'ready',
    link: {
      deliveryState: 'synced',
      noteIdHint: 12345,
      baseFields: { CaptureId: 'internal' },
      pendingWrite: { opId: 'secret-operation' },
      lastVerifiedAt: 2,
      lastError: null,
      observedRemoteFields: null,
    },
  });
  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes('12345'), false);
  assert.equal(serialized.includes('secret-operation'), false);
  assert.equal(serialized.includes('baseFields'), false);
  assert.equal(Object.hasOwn(dto.link, 'noteIdHint'), false);
});
