'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTrustedManagementSender,
  publicSettings,
  requireTrustedManagement,
} = require('../../../src/anki/setup-service');

function browserApi() {
  return {
    runtime: {
      id: 'extension-id',
      getURL(path) { return `chrome-extension://extension-id${path}`; },
    },
  };
}

test('only allowlisted extension pages may invoke trusted setup operations', () => {
  const api = browserApi();
  const optionsSender = {
    id: 'extension-id',
    url: 'chrome-extension://extension-id/src/options/options.html',
  };
  assert.equal(isTrustedManagementSender({ ...optionsSender, tab: { id: 1 } }, api), true);
  assert.equal(isTrustedManagementSender({ ...optionsSender, id: 'other-extension' }, api), false);
  assert.equal(isTrustedManagementSender({ ...optionsSender, url: 'https://example.test/' }, api), false);
  assert.equal(isTrustedManagementSender({
    ...optionsSender,
    url: 'chrome-extension://extension-id/src/popup/popup.html',
  }, api), false);

  let called = false;
  const protectedHandler = requireTrustedManagement(() => { called = true; }, api);
  assert.throws(
    () => protectedHandler({}, { sender: { id: 'extension-id', tab: { id: 2 }, url: 'https://evil.test/' } }),
    error => error.code === 'FORBIDDEN',
  );
  assert.equal(called, false);
  protectedHandler({}, { sender: optionsSender });
  assert.equal(called, true);
});

test('public settings expose key presence but never key material', () => {
  const dto = publicSettings({
    configured: true,
    endpoint: 'http://127.0.0.1:8765/',
    apiKey: 'do-not-return',
    deckName: 'Deck',
    learningLanguage: 'en',
    meaningLanguage: 'zh',
    autoCaptureEnabled: true,
    attachAudio: false,
    expectedProfile: 'Profile A',
    profileDetectionSupported: true,
  });
  assert.equal(dto.hasApiKey, true);
  assert.equal(Object.hasOwn(dto, 'apiKey'), false);
  assert.equal(JSON.stringify(dto).includes('do-not-return'), false);
});
