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

function scoreVoicePreference(voice) {
  if (!voice) return -Infinity;
  let score = 0;
  const lang = String(voice.lang || '').toLowerCase();
  if (lang.startsWith('en-us')) score += 6;
  else if (lang.startsWith('en-gb')) score += 5;
  else if (lang.startsWith('en-')) score += 4;
  else if (lang.startsWith('en')) score += 3;
  if (/english/i.test(String(voice.name || ''))) score += 1.5;
  if (voice.default) score += 1;
  if (voice.localService) score += 0.5;
  return score;
}

function pickPreferredVoice(voices) {
  if (!Array.isArray(voices) || !voices.length) return null;
  const list = [...voices];
  list.sort((a, b) => scoreVoicePreference(b) - scoreVoicePreference(a));
  const top = list.find((v) => /^en(-|$)/i.test(String(v.lang || ''))) || list[0];
  return top || null;
}

export function createSpeechSynthesisController(options = {}) {
  const {
    setSpeechPlayingState = () => {},
    getCurrentItem = () => null,
    isSpeechDesired = () => false,
  } = options;

  let speechRate = 1;
  let currentSpeechUtterance = null;
  let currentSpeechResolver = null;
  let speechPlaying = false;

  function supported() {
    return speechSynthesisSupported();
  }

  function setSpeechRate(rate) {
    const value = Number.isFinite(rate) ? rate : 1;
    speechRate = value;
    if (currentSpeechUtterance) {
      try {
        currentSpeechUtterance.rate = value;
      } catch (_) {
        // ignore
      }
    }
  }

  function getConfiguredSpeechVoice(preferredVoiceId = '') {
    if (!supported()) return null;
    try {
      const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      if (preferredVoiceId) {
        for (let i = 0; i < voices.length; i++) {
          if (getVoiceId(voices[i], i) === preferredVoiceId) {
            return voices[i];
          }
        }
      }
      return pickPreferredVoice(voices);
    } catch (_) {
      return null;
    }
  }

  function cancelSpeech() {
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
  }

  function canSpeakCurrentCard() {
    if (!isSpeechDesired?.()) return false;
    if (!supported()) return false;
    const item = getCurrentItem?.();
    if (!item) return false;
    const text = String(item.en || '').replace(/\s+/g, ' ').trim();
    return !!text;
  }

  function speakCurrentCard({ preferredVoiceId = '' } = {}) {
    if (!canSpeakCurrentCard()) return Promise.resolve(false);
    cancelSpeech();
    const item = getCurrentItem?.();
    const text = String(item?.en || '').replace(/\s+/g, ' ').trim();
    if (!text) return Promise.resolve(false);
    const Utterance = window.SpeechSynthesisUtterance || window.webkitSpeechSynthesisUtterance;
    return new Promise((resolve) => {
      let settled = false;
      const utter = new Utterance(text);
      try {
        utter.rate = speechRate;
      } catch (_) {
        // ignore
      }
      currentSpeechUtterance = utter;
      const finish = (success) => {
        if (settled) return;
        settled = true;
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
        resolve(success);
      };
      currentSpeechResolver = finish;
      const voice = getConfiguredSpeechVoice(preferredVoiceId);
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
        speechPlaying = true;
        setSpeechPlayingState(true);
      };
      utter.onend = () => finish(true);
      utter.onerror = (ev) => {
        console.warn('speech error', ev);
        finish(false);
      };
      try {
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
    const placeholder = new Option('自動選択（英語優先）', '');
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
    return speechPlaying;
  }

  return {
    supported,
    canSpeakCurrentCard,
    speakCurrentCard,
    cancelSpeech,
    setSpeechRate,
    populateVoiceOptions,
    attachVoicesChangedListener,
    getConfiguredSpeechVoice,
    isSpeaking,
  };
}
