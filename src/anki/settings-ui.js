'use strict';

const { ANKI_NAMESPACE } = require('./runtime');

function request(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const requestId = globalThis.crypto?.randomUUID?.() || `settings-${Date.now()}`;
    chrome.runtime.sendMessage({ namespace: ANKI_NAMESPACE, requestId, type, payload }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response?.ok) {
        const error = new Error(response?.error?.message || '请求失败');
        error.code = response?.error?.code;
        reject(error);
      } else {
        resolve(response.data);
      }
    });
  });
}

function elements() {
  return {
    endpoint: document.getElementById('ankiEndpoint'),
    apiKey: document.getElementById('ankiApiKey'),
    deck: document.getElementById('ankiDeck'),
    learningLanguage: document.getElementById('ankiLearningLanguage'),
    meaningLanguage: document.getElementById('ankiMeaningLanguage'),
    attachAudio: document.getElementById('ankiAttachAudio'),
    enabled: document.getElementById('ankiAutoCapture'),
    test: document.getElementById('ankiTestConnection'),
    save: document.getElementById('ankiSaveSettings'),
    status: document.getElementById('ankiSetupStatus'),
    profile: document.getElementById('ankiProfileStatus'),
    confirmation: document.getElementById('ankiSingleProfileConfirmation'),
    confirmationRow: document.getElementById('ankiSingleProfileRow'),
  };
}

function showStatus(node, message, error = false) {
  node.textContent = message;
  node.style.color = error ? '#b3261e' : 'var(--text-primary)';
}

function connectionPayload(ui) {
  const payload = { endpoint: ui.endpoint.value.trim() };
  if (ui.apiKey.value) {
    payload.apiKey = ui.apiKey.value;
  }
  return payload;
}

function setDeckOptions(select, deckNames, selected = '') {
  select.replaceChildren();
  for (const deckName of deckNames) {
    const option = document.createElement('option');
    option.value = deckName;
    option.textContent = deckName;
    option.selected = deckName === selected;
    select.append(option);
  }
}

function renderSettings(ui, settings) {
  ui.endpoint.value = settings.endpoint;
  ui.apiKey.value = '';
  ui.apiKey.placeholder = settings.hasApiKey ? '已保存；留空则保持不变' : '可选';
  ui.learningLanguage.value = settings.learningLanguage;
  ui.meaningLanguage.value = settings.meaningLanguage;
  ui.attachAudio.checked = settings.attachAudio;
  ui.enabled.checked = settings.autoCaptureEnabled;
  ui.enabled.disabled = !settings.configured;
  setDeckOptions(ui.deck, settings.deckName ? [settings.deckName] : [], settings.deckName);
  ui.profile.textContent = settings.expectedProfile
    ? `已绑定 Anki Profile：${settings.expectedProfile}`
    : settings.profileWarning || '';
  ui.confirmationRow.style.display = settings.profileDetectionSupported === false ? 'flex' : 'none';
  showStatus(ui.status, settings.configured ? '已就绪，主动查词将自动摘录。' : '尚未完成 Anki 设置。');
}

async function loadSettings(ui) {
  try {
    renderSettings(ui, await request('settings.getPublic'));
  } catch (error) {
    showStatus(ui.status, error.message, true);
  }
}

async function testConnection(ui) {
  ui.test.disabled = true;
  showStatus(ui.status, '正在连接本机 Anki…');
  try {
    const result = await request('connection.test', connectionPayload(ui));
    const selected = ui.deck.value;
    setDeckOptions(ui.deck, result.deckNames, selected);
    ui.profile.textContent = result.profileDetectionSupported
      ? `当前 Anki Profile：${result.activeProfile}`
      : result.profileWarning;
    ui.confirmationRow.style.display = result.profileDetectionSupported ? 'none' : 'flex';
    showStatus(ui.status, `连接成功（AnkiConnect ${result.version}）。请选择目标牌组。`);
  } catch (error) {
    showStatus(ui.status, error.message, true);
  } finally {
    ui.test.disabled = false;
  }
}

async function saveSettings(ui) {
  ui.save.disabled = true;
  showStatus(ui.status, '正在验证并保存…');
  try {
    const payload = {
      ...connectionPayload(ui),
      deckName: ui.deck.value,
      learningLanguage: ui.learningLanguage.value.trim(),
      meaningLanguage: ui.meaningLanguage.value.trim(),
      autoCaptureEnabled: ui.enabled.checked || ui.enabled.disabled,
      attachAudio: ui.attachAudio.checked,
      confirmSingleProfile: ui.confirmation.checked,
    };
    const settings = await request('settings.save', payload);
    renderSettings(ui, settings);
    showStatus(ui.status, '设置完成，已有本地摘录将自动继续。');
  } catch (error) {
    showStatus(ui.status, error.message, true);
  } finally {
    ui.save.disabled = false;
  }
}

async function saveCapturePreference(ui) {
  if (ui.enabled.disabled) {
    return;
  }
  try {
    const settings = await request('settings.save', { autoCaptureEnabled: ui.enabled.checked });
    showStatus(ui.status, settings.autoCaptureEnabled ? '自动摘录已启用。' : '自动摘录已暂停；已有任务仍会继续。');
  } catch (error) {
    ui.enabled.checked = !ui.enabled.checked;
    showStatus(ui.status, error.message, true);
  }
}

function initAnkiSettings() {
  const tab = document.getElementById('tab-anki');
  const panel = document.getElementById('panel-anki');
  if (!tab || !panel || tab.dataset.initialized) {
    return;
  }
  tab.dataset.initialized = 'true';
  const ui = elements();
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar button').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.main-content > div').forEach(item => item.classList.add('hidden'));
    tab.classList.add('active');
    panel.classList.remove('hidden');
    void loadSettings(ui);
  });
  ui.test.addEventListener('click', () => void testConnection(ui));
  ui.save.addEventListener('click', () => void saveSettings(ui));
  ui.enabled.addEventListener('change', () => void saveCapturePreference(ui));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnkiSettings);
  } else {
    initAnkiSettings();
  }
}

module.exports = {
  connectionPayload,
  initAnkiSettings,
  renderSettings,
  request,
  setDeckOptions,
};
