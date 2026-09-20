'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANKI_FIELD_NAMES,
  ContractError,
  validateMessageEnvelope,
  validateOriginSnapshot,
} = require('../../../src/anki/contracts');

function validSnapshot(overrides = {}) {
  return {
    language: 'EN',
    term: 'yield',
    contextText: 'We yield results.',
    targetStart: 3,
    targetEnd: 8,
    contextQuality: 'sentence',
    fallbackSourceKey: '',
    source: { kind: 'web', url: 'https://example.test/a', title: 'Example' },
    ...overrides,
  };
}

function assertContractCode(fn, code) {
  assert.throws(fn, error => error instanceof ContractError && error.code === code);
}

test('origin snapshot validates and trims the actual selected range', () => {
  const value = validateOriginSnapshot(validSnapshot({
    term: '  yield\t',
    contextText: 'We   yield\t results.',
    targetStart: 3,
    targetEnd: 11,
  }));
  assert.equal(value.language, 'en');
  assert.equal(value.term, 'yield');
  assert.equal(value.targetStart, 5);
  assert.equal(value.targetEnd, 10);
  assert.equal(value.contextText.slice(value.targetStart, value.targetEnd), value.term);
  assert.equal(Object.isFrozen(value), true);
});

test('bad ranges and empty or oversized terms are rejected without truncation', () => {
  assertContractCode(() => validateOriginSnapshot(validSnapshot({ targetStart: 2 })), 'RANGE_MISMATCH');
  assertContractCode(() => validateOriginSnapshot(validSnapshot({ term: '', targetStart: 3, targetEnd: 3 })), 'INPUT_INVALID');

  const term = 'x'.repeat(257);
  assertContractCode(() => validateOriginSnapshot(validSnapshot({
    term,
    contextText: term,
    targetStart: 0,
    targetEnd: term.length,
  })), 'INPUT_INVALID');
});

test('Unicode code points and UTF-16 boundaries are enforced', () => {
  const emojiTerm = '😀'.repeat(256);
  const valid = validateOriginSnapshot(validSnapshot({
    term: emojiTerm,
    contextText: emojiTerm,
    targetStart: 0,
    targetEnd: emojiTerm.length,
  }));
  assert.equal([...valid.term].length, 256);

  const tooMany = `${emojiTerm}😀`;
  assertContractCode(() => validateOriginSnapshot(validSnapshot({
    term: tooMany,
    contextText: tooMany,
    targetStart: 0,
    targetEnd: tooMany.length,
  })), 'INPUT_INVALID');

  assertContractCode(() => validateOriginSnapshot(validSnapshot({
    term: '\ude00',
    contextText: '😀',
    targetStart: 1,
    targetEnd: 2,
  })), 'RANGE_MISMATCH');
});

test('selection-only captures require an explicit stable source key', () => {
  assertContractCode(() => validateOriginSnapshot(validSnapshot({
    contextQuality: 'selection_only',
    fallbackSourceKey: '',
  })), 'INPUT_INVALID');
});

test('context length and unknown boundary fields are rejected', () => {
  const contextText = `${'x'.repeat(8000)}yield`;
  assertContractCode(() => validateOriginSnapshot(validSnapshot({
    term: 'yield',
    contextText,
    targetStart: 8000,
    targetEnd: 8005,
  })), 'INPUT_INVALID');
  assertContractCode(() => validateOriginSnapshot({ ...validSnapshot(), injected: true }), 'INPUT_INVALID');
});

test('message envelopes and the ordered Anki fields are frozen contracts', () => {
  const message = validateMessageEnvelope({
    namespace: 'lingkuma.anki.v1',
    requestId: 'r1',
    type: 'capture.lookup',
    payload: {},
  }, ['capture.lookup']);
  assert.equal(message.type, 'capture.lookup');
  assertContractCode(() => validateMessageEnvelope({ ...message, extra: true }), 'INPUT_INVALID');
  assertContractCode(() => validateMessageEnvelope({ ...message, type: 'anki.invoke' }, ['capture.lookup']), 'UNSUPPORTED_MESSAGE');
  assert.deepEqual(ANKI_FIELD_NAMES.slice(0, 3), ['CaptureId', 'Language', 'Term']);
  assert.equal(ANKI_FIELD_NAMES.at(-1), 'Audio');
});
