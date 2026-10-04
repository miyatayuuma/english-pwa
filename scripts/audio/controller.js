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
  let activeUserPlaybackAuthorized=false;

  function isAudioOutputLocked(){
    return audioLockState!==AUDIO_LOCK_STATES.UNLOCKED;
  }

  function isPlaybackTransitionLocked(){
    return audioLockState===AUDIO_LOCK_STATES.PENDING||audioLockState===AUDIO_LOCK_STATES.RELEASE;
  }

  function authorizeUserPlayback(){
    if(audioLockState===AUDIO_LOCK_STATES.ACTIVE) activeUserPlaybackAuthorized=true;
    return !isPlaybackTransitionLocked();
  }

  function isPlaybackAllowed(){
    return audioLockState===AUDIO_LOCK_STATES.UNLOCKED
      ||(audioLockState===AUDIO_LOCK_STATES.ACTIVE&&activeUserPlaybackAuthorized);
  }

  function stopAllTones(){
    for(const entry of activeTones){
      try{entry.osc.stop(toneCtx?.currentTime||0);}catch(_){}
      try{entry.osc.disconnect();}catch(_){}
      try{entry.gain.disconnect();}catch(_){}
    }
    activeTones.clear();
  }

  function prepareToneOutput(){
    try{
      if(typeof window==='undefined') return false;
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return false;
      if(!toneCtx) toneCtx=new AC();
      if(toneCtx.state==='suspended') toneCtx.resume().catch(()=>{});
      return true;
    }catch(_){return false;}
  }

  function playTone(type,{intensity='standard'}={}) {
    if(isAudioOutputLocked()) return false;
    try {
      if (typeof window === 'undefined') return false;
      if(!prepareToneOutput()) return false;
      const now = toneCtx.currentTime;
      let notes=[{freq:440,offset:0,duration:0.16,peak:0.12}];
      if (type === 'success') {
        notes=[
          {freq:659.25,offset:0,duration:0.11,peak:0.16},
          {freq:880,offset:0.1,duration:0.14,peak:0.18},
        ];
      } else if (type === 'perfect') {
        notes=[
          {freq:659.25,offset:0,duration:0.1,peak:0.15},
          {freq:880,offset:0.09,duration:0.11,peak:0.17},
          {freq:1046.5,offset:0.19,duration:0.16,peak:0.19},
        ];
      } else if (type === 'fail') {
        notes=[{freq:293.66,offset:0,duration:0.14,peak:0.1}];
      } else if (type === 'complete') {
        notes=[
          {freq:523.25,offset:0,duration:0.1,peak:0.13},
          {freq:659.25,offset:0.09,duration:0.1,peak:0.14},
          {freq:783.99,offset:0.18,duration:0.18,peak:0.16},
        ];
      } else if (type === 'start') {
        notes=[{freq:523.25,offset:0,duration:0.12,peak:0.12}];
      }
      const intensityScale=intensity==='subtle'?0.48:1;
      for(const note of notes){
        const osc=toneCtx.createOscillator();
        const gain=toneCtx.createGain();
        const starts=now+note.offset;
        const ends=starts+note.duration;
        osc.frequency.setValueAtTime(note.freq,starts);
        gain.gain.setValueAtTime(0,starts);
        gain.gain.linearRampToValueAtTime(note.peak*intensityScale,starts+0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001,ends);
        osc.connect(gain);
        gain.connect(toneCtx.destination);
        const entry={osc,gain};
        activeTones.add(entry);
        osc.onended=()=>{
          activeTones.delete(entry);
          try{osc.disconnect();}catch(_){}
          try{gain.disconnect();}catch(_){}
        };
        osc.start(starts);
        osc.stop(ends+0.03);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function updatePlayButtonAvailability() {
    if (!playButton) return;
    const hasSrc = !!(audio && audio.dataset && audio.dataset.srcKey);
    const canSpeak = !!(typeof getCanSpeak === 'function' && getCanSpeak());
    const locked=isPlaybackTransitionLocked();
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
    speechPlaying = isPlaybackAllowed() && !!playing;
    if(!playing&&audioLockState===AUDIO_LOCK_STATES.ACTIVE) activeUserPlaybackAuthorized=false;
    updatePlayVisualState();
  }

  function setAudioLockState(nextState=AUDIO_LOCK_STATES.UNLOCKED){
    const valid=Object.values(AUDIO_LOCK_STATES).includes(nextState)?nextState:AUDIO_LOCK_STATES.UNLOCKED;
    audioLockState=valid;
    activeUserPlaybackAuthorized=false;
    if(isPlaybackTransitionLocked()){
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
      if(!isPlaybackAllowed()){
        try{ audio.pause?.(); }catch(_){}
      }
      updatePlayVisualState();
    });
    audio.addEventListener('playing', () => {
      if(!isPlaybackAllowed()){
        try{ audio.pause?.(); }catch(_){}
      }
      updatePlayVisualState();
    });
    audio.addEventListener('pause', () => {
      if(audioLockState===AUDIO_LOCK_STATES.ACTIVE) activeUserPlaybackAuthorized=false;
      updatePlayVisualState();
    });
    audio.addEventListener('ended', () => {
      if(audioLockState===AUDIO_LOCK_STATES.ACTIVE) activeUserPlaybackAuthorized=false;
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
    prepareToneOutput,
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
    isPlaybackTransitionLocked,
    authorizeUserPlayback,
    isTonePlaying:()=>activeTones.size>0,
    stopAllTones,
  };
}
