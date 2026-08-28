const DEFAULT_MIN_SPEED = 0.5;
const DEFAULT_MAX_SPEED = 1.5;
const PREFETCH_LIMIT = 6;

export const AUDIO_LOCK_STATES=Object.freeze({
  UNLOCKED:'unlocked',
  PENDING:'pending',
  ACTIVE:'active',
  RELEASE:'release',
});

function clampSpeed(value, min = DEFAULT_MIN_SPEED, max = DEFAULT_MAX_SPEED) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num)) return 1;
  return Math.min(max, Math.max(min, num));
}

export function createAudioController({
  audioElement,
  playButton,
  speedSlider,
  speedDownButton,
  speedUpButton,
  speedValueElement,
  loadSpeed = () => 1,
  saveSpeed = () => {},
  getCanSpeak = () => false,
  onPlaybackRateChange = () => {},
} = {}) {
  const audio = audioElement;
  const PREFETCH_POOL = new Map();

  let toneCtx = null;
  const activeTones=new Set();
  let playbackRate = clampSpeed(loadSpeed() ?? 1);
  let speechPlaying = false;
  let audioLockState=AUDIO_LOCK_STATES.UNLOCKED;

  function isAudioOutputLocked(){
    return audioLockState!==AUDIO_LOCK_STATES.UNLOCKED;
  }

  function stopAllTones(){
    for(const entry of activeTones){
      try{entry.osc.stop(toneCtx?.currentTime||0);}catch(_){}
      try{entry.osc.disconnect();}catch(_){}
      try{entry.gain.disconnect();}catch(_){}
    }
    activeTones.clear();
  }

  function playTone(type) {
    if(isAudioOutputLocked()) return false;
    try {
      if (typeof window === 'undefined') return false;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (!toneCtx) {
        toneCtx = new AC();
      }
      if (toneCtx.state === 'suspended') {
        toneCtx.resume().catch(() => {});
      }
      const osc = toneCtx.createOscillator();
      const gain = toneCtx.createGain();
      const now = toneCtx.currentTime;
      let freq = 440;
      let duration = 0.2;
      let peak = 0.15;
      if (type === 'success') {
        freq = 880;
        duration = 0.25;
        peak = 0.2;
      } else if (type === 'fail') {
        freq = 300;
        duration = 0.3;
        peak = 0.18;
      } else if (type === 'start') {
        freq = 523.25;
        duration = 0.12;
        peak = 0.12;
      }
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(toneCtx.destination);
      const entry={osc,gain};
      activeTones.add(entry);
      osc.onended=()=>{
        activeTones.delete(entry);
        try{osc.disconnect();}catch(_){}
        try{gain.disconnect();}catch(_){}
      };
      osc.start(now);
      osc.stop(now + duration + 0.05);
      return true;
    } catch (_) {
      return false;
    }
  }

  function updatePlayButtonAvailability() {
    if (!playButton) return;
    const hasSrc = !!(audio && audio.dataset && audio.dataset.srcKey);
    const canSpeak = !!(typeof getCanSpeak === 'function' && getCanSpeak());
    const locked=isAudioOutputLocked();
    playButton.disabled = locked || !(hasSrc || canSpeak);
    playButton.classList?.toggle?.('audio-locked',locked);
    if(locked) playButton.setAttribute?.('aria-disabled','true');
    else playButton.removeAttribute?.('aria-disabled');
  }

  function updatePlayVisualState() {
    if (!playButton) return;
    const hasSrc = !!(audio && audio.dataset && audio.dataset.srcKey);
    const audioPlaying = !!(audio && hasSrc && !audio.paused && !audio.ended);
    const playing = audioPlaying || speechPlaying;
    playButton.classList.toggle('playing', playing);
    playButton.setAttribute('aria-pressed', playing ? 'true' : 'false');
    const icon = playButton.querySelector('.playIcon');
    if (icon) {
      icon.textContent = playing ? '⏸' : '▶️';
    }
  }

  function setSpeechPlayingState(playing) {
    speechPlaying = !isAudioOutputLocked() && !!playing;
    updatePlayVisualState();
  }

  function setAudioLockState(nextState=AUDIO_LOCK_STATES.UNLOCKED){
    const valid=Object.values(AUDIO_LOCK_STATES).includes(nextState)?nextState:AUDIO_LOCK_STATES.UNLOCKED;
    audioLockState=valid;
    if(isAudioOutputLocked()){
      try{ audio?.pause?.(); }catch(_){}
      stopAllTones();
      speechPlaying=false;
    }
    updatePlayButtonAvailability();
    updatePlayVisualState();
    return audioLockState;
  }

  if (audio?.addEventListener) {
    audio.addEventListener('play', () => {
      if(isAudioOutputLocked()){
        try{ audio.pause?.(); }catch(_){}
      }
      updatePlayVisualState();
    });
    audio.addEventListener('playing', () => {
      if(isAudioOutputLocked()){
        try{ audio.pause?.(); }catch(_){}
      }
      updatePlayVisualState();
    });
    audio.addEventListener('pause', updatePlayVisualState);
    audio.addEventListener('ended', () => {
      updatePlayVisualState();
    });
    audio.addEventListener('emptied', () => {
      updatePlayButtonAvailability();
      updatePlayVisualState();
    });
    audio.addEventListener('loadeddata', updatePlayButtonAvailability);
  }

  function formatSpeed(rate) {
    const rounded = Math.round(rate * 100) / 100;
    return `${rounded.toFixed(2).replace(/\.?0+$/, '')}×`;
  }

  function syncSpeedUI() {
    if (speedSlider) {
      const val = Math.round(playbackRate * 100) / 100;
      speedSlider.value = String(val);
    }
    if (speedValueElement) {
      speedValueElement.textContent = formatSpeed(playbackRate);
    }
  }

  function applyPlaybackRate(rate, { persist = false } = {}) {
    const clamped = clampSpeed(rate);
    playbackRate = clamped;
    if (audio) {
      try {
        audio.playbackRate = clamped;
      } catch (_) {
        // ignore
      }
    }
    if (typeof onPlaybackRateChange === 'function') {
      onPlaybackRateChange(clamped);
    }
    syncSpeedUI();
    if (persist) {
      try {
        saveSpeed(clamped);
      } catch (_) {
        // ignore persistence errors
      }
    }
  }

  function stepPlaybackRate(delta) {
    const stepped = Math.round((playbackRate + delta) * 20) / 20;
    applyPlaybackRate(stepped, { persist: true });
  }

  if (speedSlider) {
    speedSlider.addEventListener('input', () => {
      applyPlaybackRate(parseFloat(speedSlider.value), { persist: true });
    });
    speedSlider.addEventListener('change', () => {
      applyPlaybackRate(parseFloat(speedSlider.value), { persist: true });
    });
  }
  if (speedDownButton) {
    speedDownButton.addEventListener('click', () => stepPlaybackRate(-0.1));
  }
  if (speedUpButton) {
    speedUpButton.addEventListener('click', () => stepPlaybackRate(0.1));
  }

  function waitForAudioReady(el, timeout = 2000) {
    if (!el) return Promise.resolve();
    if (el.readyState >= 2) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finalize = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const onReady = () => finalize();
      const timer = setTimeout(() => finalize(), timeout);
      el.addEventListener('canplay', onReady, { once: true });
      el.addEventListener('canplaythrough', onReady, { once: true });
      el.addEventListener('loadeddata', onReady, { once: true });
      el.addEventListener('error', onReady, { once: true });
      el.addEventListener('stalled', onReady, { once: true });
    });
  }

  function clearAudioSource() {
    if (!audio) return;
    if (audio.dataset) {
      delete audio.dataset.srcKey;
    }
    audio.removeAttribute?.('src');
    try {
      audio.load?.();
    } catch (_) {
      // ignore
    }
    updatePlayButtonAvailability();
    updatePlayVisualState();
  }

  function setAudioSource(url, { timeout = 2000, forceReload = false } = {}) {
    if (!audio) return Promise.resolve();
    if (!url) {
      clearAudioSource();
      return Promise.resolve();
    }
    if (forceReload || audio.dataset?.srcKey !== url) {
      if (audio.dataset) {
        audio.dataset.srcKey = url;
      }
      audio.src = url;
      try {
        audio.playbackRate = playbackRate;
      } catch (_) {
        // ignore
      }
    }
    updatePlayButtonAvailability();
    try {
      audio.playbackRate = playbackRate;
    } catch (_) {
      // ignore
    }
    try {
      audio.load?.();
    } catch (_) {
      // ignore
    }
    return waitForAudioReady(audio, timeout);
  }

  function rememberPrefetch(url, entry) {
    PREFETCH_POOL.set(url, entry);
    if (PREFETCH_POOL.size > PREFETCH_LIMIT) {
      const firstKey = PREFETCH_POOL.keys().next().value;
      const old = PREFETCH_POOL.get(firstKey);
      if (old?.audio) {
        try {
          old.audio.pause?.();
        } catch (_) {
          // ignore
        }
        old.audio.removeAttribute?.('src');
      }
      PREFETCH_POOL.delete(firstKey);
    }
  }

  async function primeAudio(item, knownUrl, {
    shouldUseAudioForItem,
    resolveAudioUrl,
  } = {}) {
    if (!item || !item.audio_fn) return undefined;
    if (typeof shouldUseAudioForItem === 'function' && !shouldUseAudioForItem(item)) {
      return undefined;
    }
    let url = knownUrl;
    if (!url) {
      if (typeof resolveAudioUrl !== 'function') return undefined;
      url = await resolveAudioUrl(item.audio_fn);
    }
    if (!url) return undefined;
    if (PREFETCH_POOL.has(url)) {
      return PREFETCH_POOL.get(url).promise;
    }
    if (typeof Audio === 'undefined') return undefined;
    const prefetch = new Audio();
    prefetch.preload = 'auto';
    prefetch.crossOrigin = 'anonymous';
    prefetch.src = url;
    const promise = waitForAudioReady(prefetch, 4000).finally(() => {
      try {
        prefetch.pause?.();
      } catch (_) {
        // ignore
      }
    });
    try {
      prefetch.load?.();
    } catch (_) {
      // ignore
    }
    rememberPrefetch(url, { audio: prefetch, promise });
    return promise;
  }

  if (audio) {
    try {
      audio.playbackRate = playbackRate;
    } catch (_) {
      // ignore
    }
  }

  syncSpeedUI();
  updatePlayVisualState();
  updatePlayButtonAvailability();
  if (typeof onPlaybackRateChange === 'function') {
    onPlaybackRateChange(playbackRate);
  }

  return {
    playTone,
    updatePlayButtonAvailability,
    updatePlayVisualState,
    setSpeechPlayingState,
    waitForAudioReady,
    setAudioSource,
    clearAudioSource,
    primeAudio,
    getPlaybackRate: () => playbackRate,
    applyPlaybackRate,
    stepPlaybackRate,
    setAudioLockState,
    getAudioLockState:()=>audioLockState,
    isAudioOutputLocked,
    isTonePlaying:()=>activeTones.size>0,
    stopAllTones,
  };
}
