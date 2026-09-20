'use strict';

const DEFAULT_SUPERTONE_ENDPOINT = 'https://supertoneapi.com/v1/text-to-speech';
const SUPERTONE_SPEECH1_LANGUAGES = new Set(['en', 'ko', 'ja']);
const SUPERTONE_SPEECH2_LANGUAGES = new Set([
  'en', 'ko', 'ja', 'bg', 'cs', 'da', 'el', 'es', 'et', 'fi', 'hu',
  'it', 'nl', 'pl', 'pt', 'ro', 'ar', 'de', 'fr', 'hi', 'id', 'ru', 'vi',
]);

function readStorage(storage, keys) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = value => {
      if (!settled) {
        settled = true;
        resolve(value || {});
      }
    };
    try {
      const result = storage.get(keys, finish);
      if (result?.then) result.then(finish, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeLanguage(language, model) {
  const value = String(language || 'auto').trim().toLowerCase();
  const base = value === 'auto' ? 'en' : value.split(/[-_]/)[0];
  const supported = String(model || '').startsWith('sona_speech_1')
    || String(model || '').startsWith('supertonic')
    ? SUPERTONE_SPEECH1_LANGUAGES
    : SUPERTONE_SPEECH2_LANGUAGES;
  return supported.has(base) ? base : 'en';
}

function endpointUrl(baseUrl, voiceId) {
  const url = new URL(String(baseUrl || DEFAULT_SUPERTONE_ENDPOINT).replace(/\/+$/, ''));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Supertone requires an HTTPS endpoint without embedded credentials.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(voiceId)}`;
  return url.href;
}

function createSupertoneAudioProvider({ storage, fetchImpl = globalThis.fetch } = {}) {
  if (!storage?.get || typeof fetchImpl !== 'function') {
    throw new TypeError('Browser storage and fetch are required.');
  }

  async function describe(capture) {
    const values = await readStorage(storage, ['ttsConfig', 'aiConfig', 'enableWordTTS']);
    const config = values.aiConfig || {};
    if (values.enableWordTTS === false || values.ttsConfig?.wordTTSProvider !== 'supertone'
        || !config.supertoneAPIKey || !config.supertoneVoiceId) {
      return null;
    }
    const model = config.supertoneModel || 'sona_speech_1';
    const format = String(config.supertoneOutputFormat || 'mp3').toLowerCase();
    if (!['mp3', 'wav'].includes(format)) return null;
    const language = normalizeLanguage(
      config.supertoneLanguage === 'auto' ? capture.originSnapshot?.language : config.supertoneLanguage,
      model,
    );
    const voice = String(config.supertoneVoiceId);
    return Object.freeze({
      inputKey: JSON.stringify([capture.content.term, capture.originSnapshot?.language || '', voice, model, language, format]),
      endpoint: endpointUrl(config.supertoneBaseURL, voice),
      apiKey: String(config.supertoneAPIKey),
      model,
      language,
      format,
      style: String(config.supertoneStyle || '').trim(),
      speed: Number.isFinite(Number(config.supertoneSpeed)) ? Number(config.supertoneSpeed) : 1,
    });
  }

  async function getWordAudio(capture, descriptor, { signal } = {}) {
    const body = {
      text: capture.content.term,
      language: descriptor.language,
      model: descriptor.model,
      output_format: descriptor.format,
      include_phonemes: false,
      voice_settings: { pitch_shift: 0, pitch_variance: 1, speed: descriptor.speed },
      ...(descriptor.style ? { style: descriptor.style } : {}),
    };
    const response = await fetchImpl(descriptor.endpoint, {
      method: 'POST',
      headers: { 'x-sup-api-key': descriptor.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Supertone TTS failed with HTTP ${response.status}.`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime: String(response.headers?.get?.('content-type') || (descriptor.format === 'wav' ? 'audio/wav' : 'audio/mpeg'))
        .split(';')[0].trim().toLowerCase(),
    };
  }

  return Object.freeze({ describe, getWordAudio });
}

module.exports = {
  DEFAULT_SUPERTONE_ENDPOINT,
  createSupertoneAudioProvider,
  endpointUrl,
  normalizeLanguage,
  readStorage,
};
