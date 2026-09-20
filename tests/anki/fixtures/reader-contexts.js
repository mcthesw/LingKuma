'use strict';

function element({ tagName = 'SPAN', textContent = '', dataset = {}, parentElement = null, selectors = {} } = {}) {
  return {
    nodeType: 1,
    tagName,
    textContent,
    dataset,
    parentElement,
    closest(selector) {
      for (const part of selector.split(',').map(value => value.trim())) {
        if (selectors[part]) return selectors[part] === true ? this : selectors[part];
      }
      return parentElement?.closest?.(selector) || null;
    },
  };
}

function sourceFixture({ href, title, target, query = () => null } = {}) {
  const url = new URL(href);
  return {
    targetRange: { commonAncestorContainer: target, startContainer: target },
    document: { title, querySelector: query },
    location: url,
  };
}

module.exports = { element, sourceFixture };
