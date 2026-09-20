import process from 'node:process';

const endpoint = process.env.ANKI_CONNECT_ENDPOINT || 'http://127.0.0.1:8765';
const timeoutMs = Number(process.env.ANKI_CONNECT_TIMEOUT_MS || 3000);
const actions = [
  ['version', {}],
  ['apiReflect', { scopes: ['actions'], actions: ['version', 'deckNames', 'modelNames', 'modelFieldNames', 'createModel', 'findNotes', 'notesInfo', 'addNote', 'updateNoteFields', 'storeMediaFile', 'guiBrowse', 'getActiveProfile'] }],
  ['deckNames', {}],
  ['modelNames', {}],
  ['getActiveProfile', {}]
];

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    /key|token|secret|password/i.test(key) ? '<redacted>' : key,
    /key|token|secret|password/i.test(key) ? '<redacted>' : redact(item)
  ]));
}

async function invoke(action, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { parseError: true, bodyPreview: text.slice(0, 160) };
    }
    return { httpStatus: response.status, body: redact(body) };
  } finally {
    clearTimeout(timeout);
  }
}

const report = { endpoint, probedAt: new Date().toISOString(), readOnly: true, actions: {} };
for (const [action, params] of actions) {
  try {
    report.actions[action] = await invoke(action, params);
  } catch (error) {
    report.actions[action] = {
      transportError: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error)
    };
    if (action === 'version') break;
  }
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.actions.version?.transportError ? 2 : 0;
