'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupertoneAudioProvider, endpointUrl } = require('../../../src/anki/audio-provider');

function capture() {
  return { content: { term: 'hello' }, originSnapshot: { language: 'en-US' } };
}

function storage(values) {
  return { get: (_keys, callback) => callback(values) };
}

test('Supertone adapter reuses the configured word channel and returns independent bytes', async () => {
  let request;
  const provider = createSupertoneAudioProvider({
    storage: storage({
      enableWordTTS: true,
      ttsConfig: { wordTTSProvider: 'supertone' },
      aiConfig: {
        supertoneAPIKey: 'secret', supertoneVoiceId: 'voice/id', supertoneModel: 'sona_speech_1',
        supertoneLanguage: 'auto', supertoneOutputFormat: 'mp3', supertoneSpeed: '1.2',
      },
    }),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        headers: { get: () => 'audio/mpeg; charset=binary' },
        arrayBuffer: async () => new Uint8Array([0x49, 0x44, 0x33, 0]).buffer,
      };
    },
  });
  const descriptor = await provider.describe(capture());
  const result = await provider.getWordAudio(capture(), descriptor);
  assert.equal(request.url, 'https://supertoneapi.com/v1/text-to-speech/voice%2Fid');
  assert.equal(request.options.headers['x-sup-api-key'], 'secret');
  assert.deepEqual(JSON.parse(request.options.body), {
    text: 'hello', language: 'en', model: 'sona_speech_1', output_format: 'mp3', include_phonemes: false,
    voice_settings: { pitch_shift: 0, pitch_variance: 1, speed: 1.2 },
  });
  assert.deepEqual([...result.bytes], [0x49, 0x44, 0x33, 0]);
  assert.equal(result.mime, 'audio/mpeg');
  assert.equal(descriptor.inputKey.includes('secret'), false);
});

test('playback-only, disabled, and incomplete channels are unavailable', async () => {
  for (const values of [
    { ttsConfig: { wordTTSProvider: 'edge' }, aiConfig: {} },
    { enableWordTTS: false, ttsConfig: { wordTTSProvider: 'supertone' }, aiConfig: { supertoneAPIKey: 'x', supertoneVoiceId: 'v' } },
    { ttsConfig: { wordTTSProvider: 'supertone' }, aiConfig: { supertoneAPIKey: 'x' } },
  ]) {
    const provider = createSupertoneAudioProvider({ storage: storage(values), fetchImpl: async () => assert.fail('must not fetch') });
    assert.equal(await provider.describe(capture()), null);
  }
});

test('custom Supertone endpoints must be credential-free HTTPS', () => {
  assert.throws(() => endpointUrl('http://example.test/api', 'voice'), /HTTPS/);
  assert.throws(() => endpointUrl('https://user:pass@example.test/api', 'voice'), /credentials/);
  assert.equal(endpointUrl('https://tts.example.test/api/', 'voice'), 'https://tts.example.test/api/voice');
});
