'use strict';

const MAX_CONTEXT_UNITS = 8000;
const SENTENCE_BREAK = /[.!?。！？；;\n\r]/;

function trimTarget(term, start, end) {
  const leading = term.length - term.trimStart().length;
  const trailing = term.length - term.trimEnd().length;
  return {
    term: term.slice(leading, term.length - trailing),
    start: start + leading,
    end: end - trailing,
  };
}

function safeSliceBoundary(text, offset, direction) {
  let value = Math.max(0, Math.min(text.length, offset));
  if (value > 0 && value < text.length) {
    const before = text.charCodeAt(value - 1);
    const after = text.charCodeAt(value);
    if (before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF) {
      value += direction;
    }
  }
  return Math.max(0, Math.min(text.length, value));
}

function sentenceBounds(text, targetStart, targetEnd) {
  let start = targetStart;
  while (start > 0 && !SENTENCE_BREAK.test(text[start - 1])) start -= 1;
  while (start < targetStart && /\s/.test(text[start])) start += 1;

  let end = targetEnd;
  while (end < text.length && !SENTENCE_BREAK.test(text[end])) end += 1;
  if (end < text.length) end += 1;
  while (end > targetEnd && /[\r\n]/.test(text[end - 1])) end -= 1;
  return { start, end };
}

function stableFallbackSourceKey(source) {
  return [source.kind, source.documentKey || source.url || source.title || '', source.locator || '']
    .join('|');
}

function buildBoundedSnapshot({ term, contextText, targetStart, targetEnd, language, source }) {
  if (typeof term !== 'string' || typeof contextText !== 'string'
      || !Number.isInteger(targetStart) || !Number.isInteger(targetEnd)
      || contextText.slice(targetStart, targetEnd) !== term) {
    const error = new Error('The selected text is outside its real context.');
    error.code = 'RANGE_MISMATCH';
    throw error;
  }

  const trimmed = trimTarget(term, targetStart, targetEnd);
  if (!trimmed.term) {
    const error = new Error('The selected text is empty.');
    error.code = 'INPUT_INVALID';
    throw error;
  }
  if ([...trimmed.term].length > 256) {
    const error = new Error('词条超过 256 个字符，未自动摘录');
    error.code = 'INPUT_INVALID';
    throw error;
  }

  const sentence = sentenceBounds(contextText, trimmed.start, trimmed.end);
  let sliceStart = sentence.start;
  let sliceEnd = sentence.end;
  let quality = 'sentence';
  if (sliceEnd - sliceStart > MAX_CONTEXT_UNITS) {
    const room = MAX_CONTEXT_UNITS - trimmed.term.length;
    sliceStart = safeSliceBoundary(contextText, Math.max(sentence.start, trimmed.start - Math.floor(room / 2)), -1);
    sliceEnd = safeSliceBoundary(contextText, Math.min(sentence.end, sliceStart + MAX_CONTEXT_UNITS), 1);
    if (sliceEnd - sliceStart > MAX_CONTEXT_UNITS) sliceEnd = safeSliceBoundary(contextText, sliceStart + MAX_CONTEXT_UNITS, -1);
    if (sliceEnd < trimmed.end) {
      sliceEnd = trimmed.end;
      sliceStart = safeSliceBoundary(contextText, Math.max(sentence.start, sliceEnd - MAX_CONTEXT_UNITS), -1);
    }
    quality = 'fragment';
  } else if (sliceStart === trimmed.start && sliceEnd === trimmed.end) {
    quality = 'selection_only';
  }

  const boundedText = contextText.slice(sliceStart, sliceEnd);
  const boundedStart = trimmed.start - sliceStart;
  const boundedEnd = trimmed.end - sliceStart;
  return Object.freeze({
    language,
    term: trimmed.term,
    contextText: boundedText,
    targetStart: boundedStart,
    targetEnd: boundedEnd,
    contextQuality: quality,
    fallbackSourceKey: quality === 'selection_only' ? stableFallbackSourceKey(source) : '',
    source: Object.freeze({ ...source }),
  });
}

function targetElement(targetRange) {
  const node = targetRange?.commonAncestorContainer || targetRange?.startContainer;
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement || null;
}

function safeClosest(element, selector) {
  try {
    return element?.closest?.(selector) || null;
  } catch (_) {
    return null;
  }
}

function readableUrl(locationObject) {
  const href = String(locationObject?.href || '');
  return /^https?:/i.test(href) ? href : '';
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const secs = Math.floor((milliseconds % 60000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function classifyReaderSource({ document: doc, location: locationObject, targetRange } = {}) {
  const element = targetElement(targetRange);
  const title = String(doc?.title || '');
  const url = readableUrl(locationObject);
  const subtitleElement = safeClosest(element, '#overlay-subtitle-text, .subtitle-item, .ytp-caption-segment, .ytp-caption-window-container');
  if (subtitleElement) {
    const timedElement = safeClosest(element, '.subtitle-item[data-start-time]');
    const rawStart = Number(timedElement?.dataset?.startTime);
    const seconds = Number.isFinite(rawStart)
      ? rawStart / 1000
      : Number(video?.currentTime);
    return Object.freeze({
      kind: 'subtitle',
      url,
      title,
      locator: formatTime(seconds),
      documentKey: String(locationObject?.hostname || '') + String(locationObject?.pathname || ''),
    });
  }

  const pdfPage = safeClosest(element, '.page[data-page-number], [data-page-number].page');
  const pathname = String(locationObject?.pathname || '');
  if (pdfPage || /\.pdf$/i.test(pathname)) {
    const pageNumber = String(pdfPage?.dataset?.pageNumber || '');
    return Object.freeze({
      kind: 'pdf',
      url,
      title,
      locator: pageNumber ? `page ${pageNumber}` : '',
      documentKey: url || title,
    });
  }

  const epubElement = safeClosest(element, '[data-epub-chapter], [data-chapter], [data-cfi]');
  const epubId = doc?.querySelector?.('meta[name="dc.identifier"], meta[property="dc:identifier"]')?.content || '';
  const isXhtml = String(doc?.contentType || '').toLowerCase() === 'application/xhtml+xml';
  const isEpub = Boolean(epubElement || /\.(?:xhtml|epub)$/i.test(pathname) || (isXhtml && epubId));
  if (isEpub) {
    const locator = String(epubElement?.dataset?.epubChapter
      || epubElement?.dataset?.chapter
      || epubElement?.dataset?.cfi
      || pathname.split('/').pop()
      || '');
    return Object.freeze({
      kind: 'epub',
      url,
      title,
      locator,
      documentKey: String(epubId || title || (url && new URL(url).origin + pathname) || locator),
    });
  }

  return Object.freeze({ kind: 'web', url, title, locator: '', documentKey: url || title });
}

function selectContextRange(targetRange, doc) {
  const targetText = targetRange.toString();
  let element = targetElement(targetRange);
  let best = null;
  for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
    const text = String(element.textContent || '');
    if (text.length > targetText.length) {
      best = element;
      if (text.length >= targetText.length + 12 || /^(P|LI|BLOCKQUOTE|H[1-6]|FIGCAPTION|TD|DIV)$/i.test(element.tagName || '')) break;
    }
    if (element === doc?.body) break;
  }
  if (!best || !doc?.createRange) return null;
  const range = doc.createRange();
  range.selectNodeContents(best);
  return range;
}

function freezeReaderOriginSnapshot({ targetRange, contextRange, language, document: doc, location: locationObject } = {}) {
  if (!targetRange?.toString || !targetRange?.cloneRange) {
    throw new TypeError('A final selected range is required.');
  }
  const source = classifyReaderSource({ document: doc, location: locationObject, targetRange });
  const actualContextRange = contextRange?.cloneRange ? contextRange.cloneRange() : selectContextRange(targetRange, doc);
  const term = targetRange.toString();
  if (!actualContextRange) {
    return buildBoundedSnapshot({ term, contextText: term, targetStart: 0, targetEnd: term.length, language, source });
  }
  const contextText = actualContextRange.toString();
  const prefixRange = actualContextRange.cloneRange();
  try {
    prefixRange.setEnd(targetRange.startContainer, targetRange.startOffset);
    const targetStart = prefixRange.toString().length;
    return buildBoundedSnapshot({
      term,
      contextText,
      targetStart,
      targetEnd: targetStart + term.length,
      language,
      source,
    });
  } catch (_) {
    return buildBoundedSnapshot({ term, contextText: term, targetStart: 0, targetEnd: term.length, language, source });
  }
}

module.exports = {
  MAX_CONTEXT_UNITS,
  buildBoundedSnapshot,
  classifyReaderSource,
  formatTime,
  freezeReaderOriginSnapshot,
  stableFallbackSourceKey,
};
