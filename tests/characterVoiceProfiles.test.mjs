import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CHARACTER_VOICE_LIMITS,
  createCharacterVoiceRegistry,
  normalizeCharacterVoiceProfile,
  pickVoiceForCharacter,
  resolveCharacterVoiceProfile,
  resolveSpeakerCharacterId,
} from '../scripts/speech/voiceProfiles.js';
import { createSpeechSynthesisController, getVoiceId, pickPreferredVoice } from '../scripts/speech/synthesis.js';

const characterData = {
  tts_archetypes: {
    calm: { rate: 0.96, pitch: 0.97, volume: 0.98, preDelayMs: 15, postDelayMs: 12 },
    bright: { rate: 1.04, pitch: 1.03, volume: 1, preDelayMs: 20, postDelayMs: 10 },
  },
  characters: [
    { id: 'a', tts: { archetype: 'calm', voicePreferences: [{ name: 'Character A', lang: 'en-US' }] } },
    { id: 'b', tts: { archetype: 'bright', rate: 1.06, voicePreferences: [{ name: 'Character B', lang: 'en-US' }] } },
  ],
};

test('speaker A and B resolve their own profiles while an unknown speaker uses defaults', () => {
  const registry = createCharacterVoiceRegistry(characterData);
  const a = resolveCharacterVoiceProfile({ item: { speaker_tags: [{ id: 'a' }] }, registry });
  const b = resolveCharacterVoiceProfile({ item: { speaker_tags: [{ id: 'b' }] }, registry });
  const unknown = resolveCharacterVoiceProfile({ item: { speaker_tags: [{ id: 'missing' }] }, registry });
  assert.equal(a.characterId, 'a');
  assert.equal(a.rate, 0.96);
  assert.equal(a.pitch, 0.97);
  assert.equal(b.characterId, 'b');
  assert.equal(b.rate, 1.06);
  assert.equal(b.pitch, 1.03);
  assert.equal(unknown.characterId, '');
  assert.equal(unknown.rate, 1);
  assert.equal(unknown.pitch, 1);
  assert.equal(unknown.preDelayMs, 0);
});

test('multiple speaker tags prefer the active exchange character and otherwise keep the first representative', () => {
  const registry = createCharacterVoiceRegistry(characterData);
  const item = { speaker_tags: [{ id: 'a' }, { id: 'b' }] };
  assert.equal(resolveSpeakerCharacterId(item, registry, 'b'), 'b');
  assert.equal(resolveSpeakerCharacterId(item, registry, ''), 'a');
});

test('missing character voice falls back and a fixed user voice takes priority', () => {
  const automatic = { name: 'US Automatic', lang: 'en-US', voiceURI: 'auto' };
  const character = { name: 'Character A', lang: 'en-US', voiceURI: 'character' };
  const fixed = { name: 'User Fixed', lang: 'en-GB', voiceURI: 'fixed' };
  const missingProfile = normalizeCharacterVoiceProfile({ voicePreferences: [{ name: 'Not Installed', lang: 'en-US' }] });
  assert.equal(pickVoiceForCharacter({
    voices: [automatic], profile: missingProfile, getVoiceId, pickAutomaticVoice: pickPreferredVoice,
  }), automatic);
  const characterProfile = normalizeCharacterVoiceProfile({ voicePreferences: [{ name: 'Character A', lang: 'en-US' }] });
  assert.equal(pickVoiceForCharacter({
    voices: [automatic, character, fixed], userVoiceId: 'fixed', profile: characterProfile, getVoiceId, pickAutomaticVoice: pickPreferredVoice,
  }), fixed);
  assert.equal(pickVoiceForCharacter({
    voices: [automatic, character], profile: characterProfile, getVoiceId, pickAutomaticVoice: pickPreferredVoice,
  }), character);
});

test('profile controls and combined playback rate are clamped to learning-safe ranges', () => {
  const high = normalizeCharacterVoiceProfile({ rate: 4, pitch: 3, volume: 2, preDelayMs: 9999, postDelayMs: -2 }, { userPlaybackRate: 3 });
  assert.equal(high.rate, CHARACTER_VOICE_LIMITS.profileRate[1]);
  assert.equal(high.effectiveRate, CHARACTER_VOICE_LIMITS.effectiveRate[1]);
  assert.equal(high.pitch, CHARACTER_VOICE_LIMITS.pitch[1]);
  assert.equal(high.volume, CHARACTER_VOICE_LIMITS.volume[1]);
  assert.equal(high.preDelayMs, CHARACTER_VOICE_LIMITS.delayMs[1]);
  assert.equal(high.postDelayMs, CHARACTER_VOICE_LIMITS.delayMs[0]);
  const composed = normalizeCharacterVoiceProfile({ rate: 0.96 }, { userPlaybackRate: 1.1 });
  assert.equal(composed.effectiveRate, 1.056);
});

function installSpeechWindow(voices = []) {
  const spoken = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const previousWindow = globalThis.window;
  globalThis.window = {
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      getVoices: () => voices,
      speak: (utterance) => { spoken.push(utterance); },
      cancel() {},
      resume() {},
    },
  };
  return {
    spoken,
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

test('synthesis utterances receive the resolved speaker A and B profiles', async () => {
  const voiceA = { name: 'Character A', lang: 'en-US', voiceURI: 'a' };
  const voiceB = { name: 'Character B', lang: 'en-US', voiceURI: 'b' };
  const fake = installSpeechWindow([voiceA, voiceB]);
  let item = { en: 'Speaker A.', speaker_tags: [{ id: 'a' }] };
  const directData = {
    characters: [
      { id: 'a', tts: { rate: 0.94, pitch: 0.96, volume: 0.95, voicePreferences: [{ name: 'Character A', lang: 'en-US' }] } },
      { id: 'b', tts: { rate: 1.06, pitch: 1.04, volume: 1, voicePreferences: [{ name: 'Character B', lang: 'en-US' }] } },
    ],
  };
  try {
    const controller = createSpeechSynthesisController({ getCurrentItem: () => item, isSpeechDesired: () => true });
    controller.setCharacterVoiceData(directData);
    const speakingA = controller.speakCurrentCard();
    assert.equal(fake.spoken.length, 1);
    assert.equal(fake.spoken[0].voice, voiceA);
    assert.equal(fake.spoken[0].rate, 0.94);
    assert.equal(fake.spoken[0].pitch, 0.96);
    assert.equal(fake.spoken[0].volume, 0.95);
    fake.spoken[0].onstart();
    fake.spoken[0].onend();
    assert.equal(await speakingA, true);

    item = { en: 'Speaker B.', speaker_tags: [{ id: 'b' }] };
    const speakingB = controller.speakCurrentCard();
    assert.equal(fake.spoken.length, 2);
    assert.equal(fake.spoken[1].voice, voiceB);
    assert.equal(fake.spoken[1].rate, 1.06);
    assert.equal(fake.spoken[1].pitch, 1.04);
    assert.equal(fake.spoken[1].volume, 1);
    fake.spoken[1].onstart();
    fake.spoken[1].onend();
    assert.equal(await speakingB, true);
  } finally {
    fake.restore();
  }
});

test('pre-delay rechecks mic lock and recognition-active lock before synthesis starts', async () => {
  const fake = installSpeechWindow([{ name: 'Character A', lang: 'en-US', voiceURI: 'a' }]);
  let unlocked = true;
  let recognitionActive = false;
  try {
    const item = { en: 'Hello there.', speaker_tags: [{ id: 'a' }] };
    const controller = createSpeechSynthesisController({
      getCurrentItem: () => item,
      isSpeechDesired: () => true,
      canStartSpeech: () => unlocked && !recognitionActive,
    });
    controller.setCharacterVoiceData(characterData);
    const pending = controller.speakCurrentCard();
    unlocked = false;
    assert.equal(await pending, false);
    assert.equal(fake.spoken.length, 0);

    unlocked = true;
    recognitionActive = true;
    assert.equal(await controller.speakCurrentCard(), false);
    assert.equal(fake.spoken.length, 0);
  } finally {
    fake.restore();
  }
});

for (const reason of ['card change', 'session end']) {
  test(`${reason} cancels pending character synthesis`, async () => {
    const fake = installSpeechWindow([{ name: 'Character B', lang: 'en-US', voiceURI: 'b' }]);
    try {
      const controller = createSpeechSynthesisController({
        getCurrentItem: () => ({ en: 'Pending speech.', speaker_tags: [{ id: 'b' }] }),
        isSpeechDesired: () => true,
      });
      controller.setCharacterVoiceData(characterData);
      const pending = controller.speakCurrentCard();
      controller.cancelSpeech();
      assert.equal(await pending, false);
      assert.equal(fake.spoken.length, 0);
    } finally {
      fake.restore();
    }
  });
}

test('main keeps card/session cancellation and blocks character TTS for every audio lock state', async () => {
  const source = await readFile(new URL('../scripts/app/main.js', import.meta.url), 'utf8');
  assert.match(source, /function setAudioLockState\(state\)[\s\S]*applied!==AUDIO_LOCK_STATES\.UNLOCKED[\s\S]*cancelSpeech/);
  assert.match(source, /async function render\([\s\S]*stopAudio\(\)/);
  assert.match(source, /async function finalizeActiveSession[\s\S]*stopAudio\(\)/);
  assert.match(source, /if\(speechAllowed\)[\s\S]*getAudioLockState\(\)!==AUDIO_LOCK_STATES\.UNLOCKED/);
  assert.match(source, /canStartSpeech:[\s\S]*!recognitionController\?\.isActive\?\.\(\)/);
});
