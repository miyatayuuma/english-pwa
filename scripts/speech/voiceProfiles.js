const PROFILE_RATE_MIN = 0.9;
const PROFILE_RATE_MAX = 1.1;
const EFFECTIVE_RATE_MIN = 0.75;
const EFFECTIVE_RATE_MAX = 1.35;
const PITCH_MIN = 0.9;
const PITCH_MAX = 1.1;
const VOLUME_MIN = 0.75;
const VOLUME_MAX = 1;
const DELAY_MIN_MS = 0;
const DELAY_MAX_MS = 500;

export const DEFAULT_CHARACTER_VOICE_PROFILE = Object.freeze({
  characterId: '',
  archetype: 'default',
  rate: 1,
  pitch: 1,
  volume: 1,
  preDelayMs: 0,
  postDelayMs: 0,
  voicePreferences: Object.freeze([]),
  voiceCriteria: Object.freeze({
    locales: Object.freeze(['en-US']),
    qualityNameIncludes: Object.freeze(['natural', 'enhanced', 'premium']),
  }),
});

function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeLocale(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

function stringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function normalizeVoicePreference(value) {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { name } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['voiceURI', 'name', 'nameIncludes', 'lang']) {
    const normalized = String(value[key] || '').trim();
    if (normalized) result[key] = normalized;
  }
  return Object.keys(result).length ? result : null;
}

export function normalizeCharacterVoiceProfile(rawProfile = {}, { characterId = '', userPlaybackRate = 1 } = {}) {
  const raw = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  const rate = clamp(raw.rate, PROFILE_RATE_MIN, PROFILE_RATE_MAX, 1);
  const voicePreferences = (Array.isArray(raw.voicePreferences) ? raw.voicePreferences : [])
    .map(normalizeVoicePreference)
    .filter(Boolean);
  const rawCriteria = raw.voiceCriteria && typeof raw.voiceCriteria === 'object' ? raw.voiceCriteria : {};
  const locales = stringList(rawCriteria.locales);
  const qualityNameIncludes = stringList(rawCriteria.qualityNameIncludes).map((value) => value.toLowerCase());
  const playbackRate = clamp(userPlaybackRate, 0.5, 1.5, 1);

  return {
    characterId: String(characterId || raw.characterId || '').trim(),
    archetype: String(raw.archetype || 'default').trim() || 'default',
    rate,
    effectiveRate: clamp(rate * playbackRate, EFFECTIVE_RATE_MIN, EFFECTIVE_RATE_MAX, 1),
    pitch: clamp(raw.pitch, PITCH_MIN, PITCH_MAX, 1),
    volume: clamp(raw.volume, VOLUME_MIN, VOLUME_MAX, 1),
    preDelayMs: Math.round(clamp(raw.preDelayMs, DELAY_MIN_MS, DELAY_MAX_MS, 0)),
    postDelayMs: Math.round(clamp(raw.postDelayMs, DELAY_MIN_MS, DELAY_MAX_MS, 0)),
    voicePreferences,
    voiceCriteria: {
      locales: locales.length ? locales : [...DEFAULT_CHARACTER_VOICE_PROFILE.voiceCriteria.locales],
      qualityNameIncludes: qualityNameIncludes.length
        ? qualityNameIncludes
        : [...DEFAULT_CHARACTER_VOICE_PROFILE.voiceCriteria.qualityNameIncludes],
    },
  };
}

export function createCharacterVoiceRegistry(characterData) {
  const data = characterData && typeof characterData === 'object' ? characterData : {};
  const characters = Array.isArray(data) ? data : (Array.isArray(data.characters) ? data.characters : []);
  const archetypes = !Array.isArray(data) && data.tts_archetypes && typeof data.tts_archetypes === 'object'
    ? data.tts_archetypes
    : {};
  const registry = new Map();
  for (const character of characters) {
    const characterId = String(character?.id || '').trim();
    if (!characterId) continue;
    const ownProfile = character?.tts && typeof character.tts === 'object' ? character.tts : {};
    const archetypeId = String(ownProfile.archetype || '').trim();
    const archetype = archetypes[archetypeId] && typeof archetypes[archetypeId] === 'object'
      ? archetypes[archetypeId]
      : {};
    registry.set(characterId, {
      ...archetype,
      ...ownProfile,
      voiceCriteria: {
        ...(archetype.voiceCriteria || {}),
        ...(ownProfile.voiceCriteria || {}),
      },
      characterId,
      archetype: archetypeId || 'default',
    });
  }
  return registry;
}

export function resolveSpeakerCharacterId(item, registry, activeCharacterId = '') {
  const available = registry instanceof Map ? registry : new Map();
  const speakerIds = [];
  for (const tag of Array.isArray(item?.speaker_tags) ? item.speaker_tags : []) {
    const id = String(tag?.id || '').trim();
    if (id && available.has(id) && !speakerIds.includes(id)) speakerIds.push(id);
  }
  if (!speakerIds.length) return '';
  if (speakerIds.length === 1) return speakerIds[0];
  const active = String(activeCharacterId || '').trim();
  if (active && speakerIds.includes(active)) return active;
  return speakerIds[0];
}

export function resolveCharacterVoiceProfile({
  item,
  registry,
  activeCharacterId = '',
  userPlaybackRate = 1,
} = {}) {
  const characterId = resolveSpeakerCharacterId(item, registry, activeCharacterId);
  const rawProfile = characterId && registry instanceof Map ? registry.get(characterId) : null;
  return normalizeCharacterVoiceProfile(rawProfile || DEFAULT_CHARACTER_VOICE_PROFILE, {
    characterId,
    userPlaybackRate,
  });
}

function voiceMatchesPreference(voice, preference) {
  if (!voice || !preference) return false;
  if (preference.voiceURI && String(voice.voiceURI || '') !== preference.voiceURI) return false;
  if (preference.name && String(voice.name || '').toLowerCase() !== preference.name.toLowerCase()) return false;
  if (preference.nameIncludes && !String(voice.name || '').toLowerCase().includes(preference.nameIncludes.toLowerCase())) return false;
  if (preference.lang && normalizeLocale(voice.lang) !== normalizeLocale(preference.lang)) return false;
  return true;
}

export function pickVoiceForCharacter({
  voices,
  userVoiceId = '',
  profile = DEFAULT_CHARACTER_VOICE_PROFILE,
  getVoiceId = () => '',
  pickAutomaticVoice = () => null,
} = {}) {
  const list = Array.isArray(voices) ? voices : [];
  const fixedId = String(userVoiceId || '').trim();
  if (fixedId) {
    const fixed = list.find((voice, index) => getVoiceId(voice, index) === fixedId);
    if (fixed) return fixed;
  }

  for (const preference of profile?.voicePreferences || []) {
    const match = list.find((voice) => voiceMatchesPreference(voice, preference));
    if (match) return match;
  }

  const criteria = profile?.voiceCriteria || {};
  const locales = stringList(criteria.locales).map(normalizeLocale);
  const qualityMarkers = stringList(criteria.qualityNameIncludes).map((value) => value.toLowerCase());
  const criteriaMatch = list.find((voice) => {
    const lang = normalizeLocale(voice?.lang);
    if (!lang.startsWith('en')) return false;
    if (locales.length && !locales.some((locale) => lang === locale || lang.startsWith(`${locale}-`))) return false;
    if (qualityMarkers.length && !qualityMarkers.some((marker) => String(voice?.name || '').toLowerCase().includes(marker))) return false;
    return true;
  });
  return criteriaMatch || pickAutomaticVoice(list) || null;
}

export const CHARACTER_VOICE_LIMITS = Object.freeze({
  profileRate: Object.freeze([PROFILE_RATE_MIN, PROFILE_RATE_MAX]),
  effectiveRate: Object.freeze([EFFECTIVE_RATE_MIN, EFFECTIVE_RATE_MAX]),
  pitch: Object.freeze([PITCH_MIN, PITCH_MAX]),
  volume: Object.freeze([VOLUME_MIN, VOLUME_MAX]),
  delayMs: Object.freeze([DELAY_MIN_MS, DELAY_MAX_MS]),
});
