import {
  createCharacterVoiceRegistry,
  normalizeCharacterVoiceProfile,
  pickVoiceForCharacter,
  resolveCharacterVoiceProfile,
} from './voiceProfiles.js';

function speechSynthesisSupported() {
  if (typeof window === 'undefined') return false;
  if (typeof window.speechSynthesis === 'undefined') return false;
  const Utterance = window.SpeechSynthesisUtterance || window.webkitSpeechSynthesisUtterance;
  return typeof Utterance === 'function';
}

export function getVoiceId(voice, idx) {
  if (!voice) return '';
  if (voice.voiceURI) return voice.voiceURI;
  const namePart = voice.name ? String(voice.name) : 'voice';
  const langPart = voice.lang ? String(voice.lang) : String(idx ?? 0);
  return `${namePart}#${langPart}`;
}

function normalizeVoiceLang(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

export function scoreVoicePreference(voice) {
  if (!voice) return -Infinity;
  let score = 0;
  const lang = normalizeVoiceLang(voice.lang);
  // Locale is the primary criterion. An en-US voice must always outrank
  // en-GB/default/local English voices when American English is available.
  if (lang === 'en-us' || lang.startsWith('en-us-')) score += 100;
  else if (lang === 'en-ca' || lang.startsWith('en-ca-')) score += 70;
  else if (lang === 'en-au' || lang.startsWith('en-au-')) score += 65;
  else if (lang === 'en-gb' || lang.startsWith('en-gb-')) score += 60;
  else if (lang.startsWith('en-')) score += 50;
  else if (lang === 'en') score += 45;
  if (/american|united states|\bus\b/i.test(String(voice.name || ''))) score += 8;
  if (/english/i.test(String(voice.name || ''))) score += 2;
  if (voice.localService) score += 0.5;
  if (voice.default) score += 0.25;
  return score;
}

export function pickPreferredVoice(voices) {
  if (!Array.isArray(voices) || !voices.length) return null;
  const list = [...voices];
  list.sort((a, b) => scoreVoicePreference(b) - scoreVoicePreference(a));
  return list.find((v) => normalizeVoiceLang(v.lang).startsWith('en')) || list[0] || null;
}

export function createSpeechSynthesisController(options = {}) {
  const {
    setSpeechPlayingState = () => {},
    getCurrentItem = () => null,
    isSpeechDesired = () => false,
    getActiveCharacterId = () => '',
    canStartSpeech = () => true,
  } = options;

  let speechRate = 1;
  let characterVoiceRegistry = new Map();
  let currentSpeechUtterance = null;
  let currentSpeechResolver = null;
  let currentVoiceProfile = null;
  let pendingSpeechTimer = null;
  let speechGeneration = 0;
  let speechPlaying = false;

  function supported() {
    return speechSynthesisSupported();
  }

  function setSpeechRate(rate) {
    const value = Number.isFinite(rate) ? rate : 1;
    speechRate = value;
    if (currentSpeechUtterance && currentVoiceProfile) {
      try {
        currentSpeechUtterance.rate = normalizeCharacterVoiceProfile(currentVoiceProfile, {
          characterId: currentVoiceProfile.characterId,
          userPlaybackRate: value,
        }).effectiveRate;
      } catch (_) {
        // ignore
      }
    }
  }

  function setCharacterVoiceData(characterData) {
    characterVoiceRegistry = createCharacterVoiceRegistry(characterData);
    return characterVoiceRegistry.size;
  }

  function getConfiguredSpeechVoice(preferredVoiceId = '', profile = null) {
    if (!supported()) return null;
    try {
      const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      return pickVoiceForCharacter({
        voices,
        userVoiceId: preferredVoiceId,
        profile: profile || normalizeCharacterVoiceProfile(),
        getVoiceId,
        pickAutomaticVoice: pickPreferredVoice,
      });
    } catch (_) {
      return null;
    }
  }

  function clearPendingSpeechTimer() {
    if (!pendingSpeechTimer) return;
    clearTimeout(pendingSpeechTimer);
    pendingSpeechTimer = null;
  }

  function cancelSpeech() {
    speechGeneration += 1;
    clearPendingSpeechTimer();
    if (supported()) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {
        // ignore
      }
    }
    if (currentSpeechResolver) {
      const finalize = currentSpeechResolver;
      currentSpeechResolver = null;
      finalize(false);
    } else if (speechPlaying) {
      speechPlaying = false;
      setSpeechPlayingState(false);
    }
    currentSpeechUtterance = null;
    currentVoiceProfile = null;
  }

  function canSpeakCurrentCard() {
    if (!isSpeechDesired?.()) return false;
    if (!supported()) return false;
    const item = getCurrentItem?.();
    if (!item) return false;
    const text = String(item.en || '').replace(/\s+/g, ' ').trim();
    return !!text;
  }

  function speakCurrentCard({ preferredVoiceId = '', beforeSpeak = null } = {}) {
    if (!canSpeakCurrentCard()) return Promise.resolve(false);
    if (!canStartSpeech?.()) return Promise.resolve(false);
    cancelSpeech();
    const item = getCurrentItem?.();
    const text = String(item?.en || '').replace(/\s+/g, ' ').trim();
    if (!text) return Promise.resolve(false);
    const profile = resolveCharacterVoiceProfile({
      item,
      registry: characterVoiceRegistry,
      activeCharacterId: getActiveCharacterId?.(),
      userPlaybackRate: speechRate,
    });
    const Utterance = window.SpeechSynthesisUtterance || window.webkitSpeechSynthesisUtterance;
    return new Promise((resolve) => {
      let settled = false;
      const utter = new Utterance(text);
      try {
        utter.rate = profile.effectiveRate;
        utter.pitch = profile.pitch;
        utter.volume = profile.volume;
      } catch (_) {
        // ignore
      }
      currentSpeechUtterance = utter;
      currentVoiceProfile = profile;
      const generation = ++speechGeneration;
      const finish = (success) => {
        if (settled) return;
        settled = true;
        clearPendingSpeechTimer();
        if (currentSpeechResolver === finish) {
          currentSpeechResolver = null;
        }
        if (currentSpeechUtterance === utter) {
          currentSpeechUtterance = null;
        }
        if (speechPlaying) {
          speechPlaying = false;
          setSpeechPlayingState(false);
        }
        if (currentVoiceProfile === profile) {
          currentVoiceProfile = null;
        }
        resolve(success);
      };
      currentSpeechResolver = finish;
      const voice = getConfiguredSpeechVoice(preferredVoiceId, profile);
      if (voice) {
        utter.voice = voice;
        try {
          utter.lang = voice.lang || 'en-US';
        } catch (_) {
          // ignore
        }
      } else {
        try {
          utter.lang = 'en-US';
        } catch (_) {
          // ignore
        }
      }
      utter.onstart = () => {
        if (settled || generation !== speechGeneration || currentSpeechUtterance !== utter) return;
        if (!canStartSpeech?.()) {
          cancelSpeech();
          return;
        }
        speechPlaying = true;
        setSpeechPlayingState(true);
      };
      utter.onend = () => {
        if (settled || generation !== speechGeneration || currentSpeechUtterance !== utter) return;
        if (speechPlaying) {
          speechPlaying = false;
          setSpeechPlayingState(false);
        }
        if (profile.postDelayMs > 0) {
          pendingSpeechTimer = setTimeout(() => {
            pendingSpeechTimer = null;
            finish(generation === speechGeneration);
          }, profile.postDelayMs);
        } else {
          finish(true);
        }
      };
      utter.onerror = (ev) => {
        if (settled || generation !== speechGeneration || currentSpeechUtterance !== utter) return;
        console.warn('speech error', ev);
        finish(false);
      };
      const startSpeech = () => {
        pendingSpeechTimer = null;
        if (generation !== speechGeneration || !canSpeakCurrentCard() || !canStartSpeech?.()) {
          finish(false);
          return;
        }
        try {
          if(typeof beforeSpeak==='function'&&beforeSpeak()===false){finish(false);return;}
          if (!canStartSpeech?.()) { finish(false); return; }
          window.speechSynthesis.speak(utter);
          if (typeof window.speechSynthesis.resume === 'function') {
            try {
              window.speechSynthesis.resume();
            } catch (_) {
              // ignore
            }
          }
        } catch (err) {
          console.warn('speech speak failed', err);
          finish(false);
        }
      };
      if (profile.preDelayMs > 0) {
        pendingSpeechTimer = setTimeout(startSpeech, profile.preDelayMs);
      } else {
        startSpeech();
      }
    });
  }

  function populateVoiceOptions(selectEl, { storedVoiceId = '', currentValue = '' } = {}) {
    if (!selectEl) return { selected: '', hasVoices: false };
    selectEl.innerHTML = '';
    if (!supported()) {
      const opt = new Option('音声合成に未対応', '');
      opt.disabled = true;
      selectEl.appendChild(opt);
      selectEl.value = '';
      selectEl.disabled = true;
      return { selected: '', hasVoices: false };
    }
    selectEl.disabled = false;
    let voices = [];
    try {
      voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    } catch (_) {
      voices = [];
    }
    const placeholder = new Option('自動選択（米国英語優先）', '');
    selectEl.appendChild(placeholder);
    let hasStored = false;
    let hasCurrent = false;
    voices.forEach((voice, idx) => {
      const id = getVoiceId(voice, idx);
      if (!id) return;
      const label = voice.lang ? `${voice.name} (${voice.lang})` : voice.name;
      const opt = new Option(label, id);
      selectEl.appendChild(opt);
      if (currentValue && id === currentValue) {
        hasCurrent = true;
      }
      if (storedVoiceId && id === storedVoiceId) {
        hasStored = true;
      }
    });
    if (!voices.length) {
      placeholder.textContent = '自動選択（利用可能な音声が見つかりません）';
    }
    if (currentValue && hasCurrent) {
      selectEl.value = currentValue;
    } else if (storedVoiceId && hasStored) {
      selectEl.value = storedVoiceId;
    } else {
      selectEl.value = '';
    }
    return { selected: selectEl.value, hasVoices: voices.length > 0 };
  }

  function attachVoicesChangedListener(callback) {
    if (!supported() || typeof callback !== 'function') return;
    const synth = window.speechSynthesis;
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', callback);
    } else {
      synth.onvoiceschanged = callback;
    }
  }

  function isSpeaking() {
    return !!currentSpeechResolver;
  }

  return {
    supported,
    canSpeakCurrentCard,
    speakCurrentCard,
    cancelSpeech,
    setSpeechRate,
    setCharacterVoiceData,
    populateVoiceOptions,
    attachVoicesChangedListener,
    getConfiguredSpeechVoice,
    getCurrentVoiceProfile: () => currentVoiceProfile,
    isSpeaking,
  };
}
