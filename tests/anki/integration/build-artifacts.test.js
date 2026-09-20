'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');

test('build emits the isolated content facade and one background artifact', () => {
  const facadePath = path.join(root, 'dist/src/anki/content.js');
  const backgroundPath = path.join(root, 'dist/background.js');
  assert.equal(fs.existsSync(facadePath), true);
  assert.equal(fs.existsSync(backgroundPath), true);

  const listeners = [];
  const context = vm.createContext({
    chrome: {
      runtime: {
        sendMessage() {},
        onMessage: { addListener(listener) { listeners.push(listener); } },
      },
    },
  });
  context.globalThis = context;
  const facadeSource = fs.readFileSync(facadePath, 'utf8');
  vm.runInContext(facadeSource, context);
  const firstFacade = context.LingKumaAnki;
  vm.runInContext(facadeSource, context);

  assert.equal(context.LingKumaAnki, firstFacade);
  assert.equal(firstFacade.namespace, 'lingkuma.anki.v1');
  assert.equal(typeof firstFacade.captureLookup, 'function');
  assert.equal(Object.keys(context).includes('LingKumaAnki'), false);
});

test('built manifest grants alarms without widening host access', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json'), 'utf8'));
  assert.equal(manifest.permissions.includes('alarms'), true);
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
});
