'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildIdentityParts,
  createCaptureIdentity,
  isCaptureId,
} = require('../../../src/anki/identity');

const vectors = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../docs/anki-phase1/fixtures/identity-v1.json'),
  'utf8',
));

test('all frozen identity v1 vectors match exactly', async t => {
  assert.equal(vectors.schemaVersion, 1);
  assert.equal(vectors.cases.length, 14);

  for (const vector of vectors.cases) {
    await t.test(vector.name, async () => {
      const actual = await createCaptureIdentity(vector.input);
      assert.equal(actual.normalizedTerm, vector.expected.normalizedTerm);
      assert.equal(actual.normalizedContext, vector.expected.normalizedContext);
      assert.equal(actual.normalizedStart, vector.expected.normalizedStart);
      assert.equal(actual.normalizedEnd, vector.expected.normalizedEnd);
      assert.deepEqual(actual.identityTuple, vector.expected.identityTuple);
      assert.equal(actual.captureId, vector.expected.captureId);
      assert.equal(isCaptureId(actual.captureId), true);
    });
  }
});

test('normal contexts ignore fallback source while selection-only contexts retain it', async () => {
  const normal = {
    language: 'en',
    term: 'yield',
    contextText: 'yield',
    targetStart: 0,
    targetEnd: 5,
    contextQuality: 'fragment',
    fallbackSourceKey: 'web:https://ignored.test',
  };
  const first = await createCaptureIdentity(normal);
  const second = await createCaptureIdentity({ ...normal, fallbackSourceKey: 'web:https://other.test' });
  assert.equal(first.captureId, second.captureId);
  assert.equal(first.identityTuple.at(-1), '');

  const selected = buildIdentityParts({ ...normal, contextQuality: 'selection_only' });
  assert.equal(selected.identityTuple.at(-1), 'web:https://ignored.test');
});

test('case and repeated target positions remain distinct', async () => {
  const upper = await createCaptureIdentity({
    language: 'en', term: 'US', contextText: 'US and us', targetStart: 0, targetEnd: 2,
    contextQuality: 'sentence', fallbackSourceKey: '',
  });
  const lower = await createCaptureIdentity({
    language: 'en', term: 'us', contextText: 'US and us', targetStart: 7, targetEnd: 9,
    contextQuality: 'sentence', fallbackSourceKey: '',
  });
  assert.notEqual(upper.captureId, lower.captureId);

  const first = await createCaptureIdentity({
    language: 'en', term: 'bank', contextText: 'bank bank', targetStart: 0, targetEnd: 4,
    contextQuality: 'sentence', fallbackSourceKey: '',
  });
  const second = await createCaptureIdentity({
    language: 'en', term: 'bank', contextText: 'bank bank', targetStart: 5, targetEnd: 9,
    contextQuality: 'sentence', fallbackSourceKey: '',
  });
  assert.notEqual(first.captureId, second.captureId);
});
