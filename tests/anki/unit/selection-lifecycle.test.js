'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
}

test('A48 custom selection initialization is idempotent and page disposal removes capture listeners', () => {
  const document = {
    ...eventTarget(),
    readyState: 'complete',
    body: {},
  };
  const window = {
    ...eventTarget(),
    location: { href: 'https://article.test/' },
    getSelection: () => ({ anchorNode: null, focusNode: null, rangeCount: 0, toString: () => '' }),
  };
  window.window = window;
  const context = {
    window,
    globalThis: window,
    document,
    navigator: { language: 'en' },
    chrome: { storage: { local: { get: (_keys, callback) => callback({ pluginBlacklistWebsites: '' }) } } },
    console: { log() {}, error() {}, warn() {} },
    setTimeout,
    clearTimeout,
  };
  const script = fs.readFileSync(
    path.resolve(__dirname, '../../../src/service/a5_custom_word_selection.js'),
    'utf8',
  );
  vm.runInNewContext(script, context, { filename: 'a5_custom_word_selection.js' });

  const captureTypes = ['mouseup', 'touchend', 'selectionchange', 'click', 'touchstart', 'keydown'];
  const expectedActive = { mouseup: 1, touchend: 2, selectionchange: 1, click: 1, touchstart: 1, keydown: 1 };
  assert.equal(Object.entries(expectedActive).every(([type, count]) => document.listeners.get(type)?.size === count), true);
  window.initCustomWordSelection();
  window.initCustomWordSelection();
  assert.equal(Object.entries(expectedActive).every(([type, count]) => document.listeners.get(type)?.size === count), true);

  const pagehide = [...window.listeners.get('pagehide')][0];
  pagehide();
  assert.equal(captureTypes.every(type => document.listeners.get(type)?.size === (type === 'touchend' ? 1 : 0)), true);
  context.chrome.storage.local.get = (_keys, callback) => callback({
    pluginBlacklistWebsites: '*://blocked.test/*',
  });
  window.location.href = 'https://blocked.test/private';
  window.initCustomWordSelection();
  assert.equal(captureTypes.every(type => document.listeners.get(type)?.size === (type === 'touchend' ? 1 : 0)), true);
});
