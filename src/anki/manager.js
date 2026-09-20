'use strict';

const STATUS_LABELS = Object.freeze({
  synced: '已同步', waiting_content: '等待释义', content_failed: '释义失败',
  waiting_setup: '等待设置', waiting_anki: '等待 Anki', conflict: '需要处理',
  remote_missing: 'Anki 笔记不存在', blocked: '已阻止', excluded: '已停止管理',
});
const EDIT_FIELDS = Object.freeze(['meaning', 'reading', 'sentenceTranslation', 'usage', 'userNote']);
const CONFLICT_FIELDS = Object.freeze(['Term', 'Reading', 'Meaning', 'Context', 'SentenceTranslation', 'Usage', 'UserNote', 'Source', 'Audio']);
const state = { items: [], nextCursor: null, loading: false };
const elements = {};

function request(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      namespace: 'lingkuma.anki.v1', type, payload,
      requestId: `manager-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) {
        const error = new Error(response?.error?.message || '操作失败');
        error.code = response?.error?.code || 'INTERNAL_ERROR';
        return reject(error);
      }
      resolve(response.data);
    });
  });
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? '#b42318' : '';
}

function button(label, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.dataset.action = action;
  if (className) element.className = className;
  return element;
}

function sourceText(source) {
  if (!source) return '';
  return [source.title || source.documentKey || source.url || source.kind, source.locator].filter(Boolean).join(' · ');
}

function renderConflict(container, item) {
  if (item.status !== 'conflict' || !item.remoteFields) return;
  container.hidden = false;
  const title = document.createElement('h3');
  title.textContent = '本地与 Anki 的差异';
  container.append(title);
  const grid = document.createElement('div');
  grid.className = 'conflict-grid';
  for (const field of CONFLICT_FIELDS) {
    if (item.localFields[field] === item.remoteFields[field]) continue;
    for (const [label, fields] of [['本地', item.localFields], ['Anki', item.remoteFields]]) {
      const cell = document.createElement('label');
      cell.className = 'conflict-field';
      const heading = document.createElement('strong');
      heading.textContent = `${field} · ${label}`;
      cell.append(heading, document.createTextNode(fields[field] || '（空）'));
      if (label === '本地') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'localField';
        checkbox.value = field;
        checkbox.checked = true;
        heading.prepend(checkbox, ' ');
      }
      grid.append(cell);
    }
  }
  container.append(grid);
  const actions = document.createElement('div');
  actions.className = 'conflict-actions';
  actions.append(button('保留 Anki', 'resolve-remote'), button('使用本地', 'resolve-local', 'primary'), button('按勾选字段处理', 'resolve-fields'));
  container.append(actions);
}

function renderRecord(item) {
  const fragment = elements.template.content.cloneNode(true);
  const article = fragment.querySelector('.record');
  article.dataset.captureId = item.captureId;
  article.querySelector('h2').textContent = item.content.term;
  article.querySelector('.badge').textContent = STATUS_LABELS[item.status] || item.status;
  article.querySelector('time').textContent = new Date(item.updatedAt).toLocaleString();
  article.querySelector('time').dateTime = new Date(item.updatedAt).toISOString();
  article.querySelector('.context').textContent = item.content.contextText;
  article.querySelector('.meaning').textContent = item.content.meaning || '暂无释义';
  article.querySelector('.source').textContent = sourceText(item.content.source);
  article.querySelector('.meta').textContent = `最后核实：${item.lastVerifiedAt ? new Date(item.lastVerifiedAt).toLocaleString() : '尚未核实'} · 音频：${item.mediaState}`;
  const error = article.querySelector('.error');
  if (item.lastError || item.mediaError) {
    const value = item.lastError || item.mediaError;
    error.hidden = false;
    error.textContent = `${value.code || 'ERROR'}：${value.message || '需要处理'}`;
  }
  const actions = article.querySelector('.actions');
  if (item.active) {
    actions.append(button('编辑', 'edit'), button('在 Anki 中打开', 'open'));
    if (item.status === 'content_failed' || item.status === 'blocked'
        || (item.status === 'conflict' && !item.remoteFields)
        || ['failed', 'unavailable'].includes(item.mediaState)) {
      actions.append(button('重试', 'retry'));
    }
    if (item.status === 'remote_missing') actions.append(button('显式重建', 'recreate', 'primary'));
    actions.append(button('停止管理', 'exclude', 'danger'));
  } else {
    actions.append(button('恢复管理', 'resume', 'primary'));
  }
  const form = article.querySelector('.edit-form');
  for (const field of EDIT_FIELDS) form.elements[field].value = item.content[field] || '';
  form.dataset.revision = String(item.contentRevision);
  renderConflict(article.querySelector('.conflict'), item);
  return fragment;
}

function render() {
  elements.records.replaceChildren();
  const groups = new Map();
  for (const item of state.items) {
    const key = item.content.term.toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, { term: item.content.term, items: [] });
    groups.get(key).items.push(item);
  }
  for (const group of groups.values()) {
    const section = document.createElement('section');
    section.className = 'term-group';
    const heading = document.createElement('h2');
    heading.textContent = group.items.length > 1 ? `${group.term}（${group.items.length} 个语境）` : group.term;
    section.append(heading);
    for (const item of group.items) section.append(renderRecord(item));
    elements.records.append(section);
  }
  if (state.items.length === 0 && !state.loading) setStatus('没有符合条件的摘录。');
  elements.more.hidden = !state.nextCursor;
}

async function load(reset = false) {
  if (state.loading) return;
  state.loading = true;
  setStatus('正在加载…');
  try {
    const result = await request('capture.list', {
      query: elements.query.value.trim(), state: elements.state.value || null,
      cursor: reset ? null : state.nextCursor, limit: 30,
    });
    state.items = reset ? result.items : state.items.concat(result.items);
    state.nextCursor = result.nextCursor;
    setStatus(`${state.items.length} 条摘录`);
    render();
  } catch (error) {
    setStatus(`${error.code || 'ERROR'}：${error.message}`, true);
  } finally {
    state.loading = false;
  }
}

function currentItem(article) {
  return state.items.find(item => item.captureId === article.dataset.captureId);
}

async function runCommand(article, type, payload) {
  setStatus('正在处理…');
  const updated = await request(type, payload);
  if (updated?.captureId) {
    const index = state.items.findIndex(item => item.captureId === updated.captureId);
    if (index >= 0) state.items[index] = updated;
  }
  setStatus('已完成。');
  render();
}

async function handleAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const article = target.closest('.record');
  const item = currentItem(article);
  if (!item) return;
  const action = target.dataset.action;
  try {
    if (action === 'edit') article.querySelector('.edit-form').hidden = false;
    else if (action === 'cancel-edit') article.querySelector('.edit-form').hidden = true;
    else if (action === 'open') await runCommand(article, 'capture.openInAnki', { captureId: item.captureId });
    else if (action === 'exclude') await runCommand(article, 'capture.exclude', { captureId: item.captureId });
    else if (action === 'resume') await runCommand(article, 'capture.resume', { captureId: item.captureId });
    else if (action === 'retry' || action === 'recreate') await runCommand(article, 'capture.retry', { captureId: item.captureId, expectedRevision: item.contentRevision });
    else if (action.startsWith('resolve-')) {
      const strategy = action.slice('resolve-'.length);
      const localFields = strategy === 'fields' ? [...article.querySelectorAll('input[name="localField"]:checked')].map(input => input.value) : [];
      await runCommand(article, 'capture.resolve', { captureId: item.captureId, expectedRevision: item.contentRevision, strategy, localFields });
    }
  } catch (error) {
    setStatus(`${error.code || 'ERROR'}：${error.message}`, true);
  }
}

async function handleEdit(event) {
  const form = event.target.closest('.edit-form');
  if (!form) return;
  event.preventDefault();
  const article = form.closest('.record');
  const item = currentItem(article);
  const patch = Object.fromEntries(EDIT_FIELDS.map(field => [field, form.elements[field].value]));
  try {
    await runCommand(article, 'capture.edit', { captureId: item.captureId, expectedRevision: Number(form.dataset.revision), patch });
  } catch (error) {
    setStatus(`${error.code || 'ERROR'}：${error.message}`, true);
  }
}

function initialize() {
  Object.assign(elements, {
    filters: document.getElementById('filters'), query: document.getElementById('query'),
    state: document.getElementById('state'), status: document.getElementById('status'),
    records: document.getElementById('records'), more: document.getElementById('more'),
    template: document.getElementById('record-template'),
  });
  elements.filters.addEventListener('submit', event => { event.preventDefault(); void load(true); });
  elements.more.addEventListener('click', () => void load(false));
  elements.records.addEventListener('click', event => void handleAction(event));
  elements.records.addEventListener('submit', event => void handleEdit(event));
  void load(true);
}

document.addEventListener('DOMContentLoaded', initialize, { once: true });

module.exports = { CONFLICT_FIELDS, EDIT_FIELDS, STATUS_LABELS, sourceText };
