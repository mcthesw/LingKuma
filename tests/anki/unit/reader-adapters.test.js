'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBoundedSnapshot,
  classifyReaderSource,
  freezeReaderOriginSnapshot,
} = require('../../../src/anki/reader-adapters');
const { element, sourceFixture } = require('../fixtures/reader-contexts');

test('repeated phrase offsets select the exact occurrence across inline nodes', () => {
  const startContainer = {};
  const makeContextRange = () => ({
    cloneRange: makeContextRange,
    setEnd(container, offset) {
      assert.equal(container, startContainer);
      assert.equal(offset, 2);
      this.isPrefix = true;
    },
    toString() {
      return this.isPrefix ? 'repeat once, ' : 'repeat once, repeat twice.';
    },
  });
  const contextRange = makeContextRange();
  const targetRange = {
    cloneRange() { return this; },
    toString: () => 'repeat',
    startContainer,
    startOffset: 2,
    commonAncestorContainer: element({ textContent: 'repeat once, repeat twice.' }),
  };
  const snapshot = freezeReaderOriginSnapshot({
    targetRange,
    contextRange,
    language: 'en',
    document: { title: 'Repeated', querySelector: () => null },
    location: new URL('https://reader.test/article?chapter=2#line-4'),
  });

  assert.equal(snapshot.targetStart, 13);
  assert.equal(snapshot.contextText.slice(snapshot.targetStart, snapshot.targetEnd), 'repeat');
  assert.equal(snapshot.source.url, 'https://reader.test/article?chapter=2#line-4');
});

test('emoji and combining marks keep UTF-16 exact offsets while bounding long context', () => {
  const term = '🧑🏽‍💻 cafe\u0301';
  const prefix = 'x'.repeat(5000);
  const suffix = 'y'.repeat(5000);
  const contextText = `${prefix}${term}${suffix}`;
  const snapshot = buildBoundedSnapshot({
    term,
    contextText,
    targetStart: prefix.length,
    targetEnd: prefix.length + term.length,
    language: 'en',
    source: { kind: 'web', url: 'https://example.test/' },
  });

  assert.equal(snapshot.contextQuality, 'fragment');
  assert.ok(snapshot.contextText.length <= 8000);
  assert.equal(snapshot.contextText.slice(snapshot.targetStart, snapshot.targetEnd), term);
});

test('selection-only fallback is real text with stable document and locator identity', () => {
  const snapshot = buildBoundedSnapshot({
    term: '孤立片段',
    contextText: '孤立片段',
    targetStart: 0,
    targetEnd: 4,
    language: 'zh',
    source: { kind: 'epub', documentKey: 'urn:isbn:fixture', locator: 'chapter-7' },
  });

  assert.equal(snapshot.contextQuality, 'selection_only');
  assert.equal(snapshot.contextText, snapshot.term);
  assert.equal(snapshot.fallbackSourceKey, 'epub|urn:isbn:fixture|chapter-7');
});

test('reader source classification preserves available PDF, EPUB and subtitle locators', () => {
  const pdfPage = element({ dataset: { pageNumber: '12' } });
  const pdfTarget = element({ parentElement: pdfPage, selectors: { '.page[data-page-number]': pdfPage } });
  const pdf = classifyReaderSource(sourceFixture({
    href: 'https://files.test/book.pdf',
    title: 'Book',
    target: pdfTarget,
  }));

  const chapter = element({ dataset: { epubChapter: 'Chapter 4' } });
  const epubTarget = element({ parentElement: chapter, selectors: { '[data-epub-chapter]': chapter } });
  const epub = classifyReaderSource(sourceFixture({
    href: 'blob:https://reader.test/random-session',
    title: 'Novel',
    target: epubTarget,
    query: selector => selector.startsWith('meta[') ? { content: 'urn:isbn:978-fixture' } : null,
  }));

  const subtitleItem = element({ dataset: { startTime: '65432' } });
  const subtitleTarget = element({
    parentElement: subtitleItem,
    selectors: {
      '.subtitle-item': subtitleItem,
      '.subtitle-item[data-start-time]': subtitleItem,
    },
  });
  const subtitle = classifyReaderSource(sourceFixture({
    href: 'https://www.youtube.com/watch?v=fixture',
    title: 'Video',
    target: subtitleTarget,
  }));
  const web = classifyReaderSource(sourceFixture({
    href: 'https://reader.test/article?chapter=2#line-4',
    title: 'Article',
    target: element(),
    query: () => ({ content: 'unrelated-metadata' }),
  }));


  assert.equal(web.kind, 'web');
  assert.deepEqual({ kind: pdf.kind, locator: pdf.locator }, { kind: 'pdf', locator: 'page 12' });
  assert.deepEqual(
    { kind: epub.kind, url: epub.url, locator: epub.locator, documentKey: epub.documentKey },
    { kind: 'epub', url: '', locator: 'Chapter 4', documentKey: 'urn:isbn:978-fixture' },
  );
  assert.deepEqual(
    { kind: subtitle.kind, locator: subtitle.locator },
    { kind: 'subtitle', locator: '00:01:05.432' },
  );
});
