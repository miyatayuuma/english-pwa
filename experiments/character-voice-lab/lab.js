import { setupBenchmark } from "./benchmark-ui.js";
const byId = (id) => document.getElementById(id);
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const option = (value, label) => new Option(label, value);
const player = byId("player");
const status = byId("now-playing");
const stop = byId("stop");
const comparison = byId("comparison");
const cards = byId("voices");
const synth = window.speechSynthesis;
const tabs = [...document.querySelectorAll('[role="tab"]')];
const state = { mode: "cast", cast: "everyday", models: "everyday", speaker: "bob",
  dialogue: "umbrella", selectedVoice: new Map(), speechToken: 0, queue: [] };
const modelNames = { kokoro: "Kokoro-82M", supertonic: "Supertonic 3" };

function resetPlayback(message = "聴きたい音声を選んでください。") {
  state.speechToken++;
  state.queue = [];
  synth?.cancel();
  player.pause();
  player.removeAttribute("src");
  player.load();
  player.hidden = true;
  stop.hidden = true;
  status.textContent = message;
}

async function playNext() {
  const clip = state.queue.shift();
  if (!clip) {
    status.textContent = "再生が終わりました。";
    stop.hidden = true;
    return;
  }
  const token = state.speechToken;
  player.src = clip.path;
  player.hidden = false;
  stop.hidden = false;
  status.textContent = `再生中 · ${clip.label}`;
  try {
    await player.play();
  } catch {
    if (token === state.speechToken) {
      status.textContent = "プレーヤーの再生ボタンを押してください。";
    }
  }
}

player.addEventListener("ended", () => void playNext());
player.addEventListener("error", () => {
  if (player.getAttribute("src")) {
    state.queue = [];
    status.textContent = "音声を読み込めませんでした。配布ファイルを開き直してください。";
  }
});
stop.addEventListener("click", () => resetPlayback());

function playClips(clips, engine) {
  resetPlayback();
  state.queue = clips.map(({ clip, name }) => ({ path: clip.url || clip.path,
    label: `${name} / ${modelNames[engine]}` }));
  void playNext();
}

function localEnglishVoices() {
  return (synth?.getVoices() || []).filter((voice) => /^en([_-]|$)/i.test(voice.lang));
}

function characterBrowserVoice(character, chosen) {
  const voices = localEnglishVoices();
  if (chosen) {
    const manual = voices.find((voice) => voice.voiceURI === chosen);
    if (manual) return manual;
  }
  const lang = (value) => String(value || "").toLowerCase().replaceAll("_", "-");
  const profile = character.tts;
  for (const pref of profile.voicePreferences || []) {
    const match = voices.find((voice) =>
      (!pref.voiceURI || voice.voiceURI === pref.voiceURI) &&
      (!pref.name || voice.name.toLowerCase() === pref.name.toLowerCase()) &&
      (!pref.nameIncludes || voice.name.toLowerCase().includes(pref.nameIncludes.toLowerCase())) &&
      (!pref.lang || lang(voice.lang) === lang(pref.lang)));
    if (match) return match;
  }
  const { locales = [], qualityNameIncludes = [] } = profile.voiceCriteria || {};
  const qualityMatch = voices.find((voice) =>
    (!locales.length || locales.some((locale) => lang(voice.lang) === lang(locale) ||
      lang(voice.lang).startsWith(`${lang(locale)}-`))) &&
    (!qualityNameIncludes.length || qualityNameIncludes.some((marker) =>
      voice.name.toLowerCase().includes(marker.toLowerCase()))));
  if (qualityMatch) return qualityMatch;
  const score = (voice) => {
    const locale = lang(voice.lang);
    const localeScore = [["en-us", 100], ["en-ca", 70], ["en-au", 65], ["en-gb", 60]]
      .find(([prefix]) => locale === prefix || locale.startsWith(`${prefix}-`))?.[1] ||
      (locale === "en" ? 45 : 50);
    return localeScore + (/american|united states|\bus\b/i.test(voice.name) ? 8 : 0) +
      (/english/i.test(voice.name) ? 2 : 0) + (voice.localService ? 0.5 : 0) + (voice.default ? 0.25 : 0);
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

function speakTurns(turns, roster, chosen) {
  resetPlayback();
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    status.textContent = "このブラウザでは標準音声を利用できません。";
    return;
  }
  const token = state.speechToken;
  let i = 0;
  function speakNext() {
    if (token !== state.speechToken) return;
    if (i === turns.length) {
      status.textContent = "再生が終わりました。";
      stop.hidden = true;
      return;
    }
    const turn = turns[i++];
    const character = roster.get(turn.speaker);
    const utterance = new SpeechSynthesisUtterance(turn.text);
    const voice = characterBrowserVoice(character, chosen);
    utterance.lang = voice?.lang || "en-US";
    if (voice) utterance.voice = voice;
    const { rate = 1, pitch = 1, volume = 1, postDelayMs = 0 } = character.tts;
    Object.assign(utterance, { rate, pitch, volume });
    utterance.onstart = () => {
      if (token === state.speechToken) {
        status.textContent = `再生中 · ${character.name} / ${voice?.name || "端末標準"}`;
      }
    };
    utterance.onend = () => setTimeout(speakNext, postDelayMs);
    utterance.onerror = (event) => {
      if (token === state.speechToken) resetPlayback(`端末の標準音声を再生できませんでした（${event.error}）。`);
    };
    stop.hidden = false;
    status.textContent = "ブラウザ標準音声を準備中。";
    synth.speak(utterance);
  }
  speakNext();
}

function selectField(container, label, options, value, onchange) {
  const field = element("label", label);
  const select = element("select");
  select.setAttribute("aria-label", label);
  select.append(...options);
  select.value = value;
  select.addEventListener("change", () => onchange(select.value));
  field.append(select);
  container.append(field);
}

function voiceCard(character, buttonLabel, play, { subtitle, details, candidate, name } = {}) {
  const card = byId("voice-card").content.firstElementChild.cloneNode(true);
  const heading = card.querySelector("h3");
  heading.textContent = name || character.name;
  if (candidate) heading.append(element("span", "採用候補", "pill"));
  const photo = card.querySelector("img");
  if (character.image) {
    photo.src = character.image;
    photo.loading = "lazy";
  } else {
    photo.remove();
  }
  card.querySelector(".meta").textContent = subtitle || character.name_ja;
  const button = card.querySelector("button");
  button.textContent = buttonLabel;
  button.setAttribute("aria-label", `${name || character.name} ${buttonLabel}`);
  button.addEventListener("click", play);
  if (details) {
    const list = card.querySelector("dl");
    for (const [label, value] of details) list.append(element("dt", label), element("dd", value));
  } else {
    card.querySelector("details").remove();
  }
  cards.append(card);
}

function setupLab({ corpus, profiles, clips, characters, portraits = {} }) {
  const roster = new Map(characters.characters.map((speaker) => {
    const avatar = portraits[speaker.id] || `../../${encodeURIComponent(speaker.name)}.png`;
    const base = characters.tts_archetypes[speaker.tts.archetype] || {};
    return [speaker.id, { ...speaker, image: avatar, tts: { ...base, ...speaker.tts,
      voiceCriteria: { ...base.voiceCriteria, ...speaker.tts.voiceCriteria } } }];
  }));
  const lines = new Map(corpus.utterances.map((line) => [line.id, line]));
  const selection = (value, field) => {
    state[field] = value;
    resetPlayback();
    render();
    comparison.querySelectorAll("select")[field === "speaker" ? 1 : 0]?.focus();
  };
  const textChoice = (ids) => ids.map((id) => {
    const line = lines.get(id);
    return option(id, `${line.variant || line.kind} · ${line.text.length > 63 ? line.text.slice(0, 60) + "…" : line.text}`);
  });
  const clipFor = (engine, name, line) => ({ clip: clips[engine][`${name}/${line}`], name: roster.get(name).name });
  function render() {
    comparison.replaceChildren();
    cards.replaceChildren();
    const controls = element("div", "", "controls field-group");
    comparison.append(controls);
    if (state.mode === "dialogues") {
      selectField(controls, "会話", corpus.dialogues.map(({ id, title }) => option(id, title)),
        state.dialogue, (value) => selection(value, "dialogue"));
      const dialogue = corpus.dialogues.find(({ id }) => id === state.dialogue);
      const turns = element("ol", "", "turns");
      dialogue.turns.forEach((turn) => {
        const line = element("li");
        const text = element("span", turn.text);
        text.lang = "en";
        line.append(element("b", roster.get(turn.speaker).name), text);
        turns.append(line);
      });
      comparison.append(turns);
      const pair = [...new Set(dialogue.turns.map(({ speaker }) => roster.get(speaker).name))].join(" / ");
      for (const engine of Object.keys(modelNames)) {
        const recorded = dialogue.turns.map(({ speaker }, i) => clipFor(engine, speaker, `${dialogue.id}-${i + 1}`));
        if (recorded.every(({ clip }) => clip)) {
          voiceCard(roster.get(dialogue.turns[0].speaker), "会話を再生", () => playClips(recorded, engine),
            { name: modelNames[engine], subtitle: pair, candidate: engine === "kokoro" });
        }
      }
      voiceCard({}, "会話を再生", () => speakTurns(dialogue.turns, roster),
        { name: "ブラウザ標準", subtitle: "端末で合成 · 人物別の設定" });
      return;
    }

    const cast = state.mode === "cast";
    const ids = cast ? corpus.common : corpus.pilot;
    selectField(controls, "評価文", textChoice(ids), state[state.mode], (value) => selection(value, state.mode));
    const line = lines.get(state[state.mode]);
    const english = element("p", line.text, "english");
    english.lang = "en";
    comparison.append(english, element("p", line.check, "note"));

    if (cast) {
      comparison.append(element("p", "採用候補 · Kokoro-82M", "cast-candidate"));
      for (const profile of profiles.voices) {
        const character = roster.get(profile.id);
        voiceCard(character, "▶ 再生", () => playClips([clipFor("kokoro", profile.id, line.id)], "kokoro"),
          { subtitle: `${character.name_ja} · ${profile.accent.toUpperCase()} · ${profile.timbre}`,
            details: [["声ID", profile.voice], ["高さの目安", profile.pitch], ["話速", `${profile.speed}×`],
              ["明瞭さ", profile.clarity], ["感情", profile.emotion], ["話し方", profile.style]] });
      }
      return;
    }

    selectField(controls, "キャラクター", Object.keys(profiles.pilot).map((id) => option(id, roster.get(id).name)),
      state.speaker, (value) => selection(value, "speaker"));
    const character = roster.get(state.speaker);
    const browserVoice = localEnglishVoices();
    if (browserVoice.length) {
      selectField(controls, "ブラウザ音声",
        [option("", "人物設定で自動選択"), ...browserVoice.map((voice) =>
          option(voice.voiceURI, `${voice.name} (${voice.lang}, ${voice.localService ? "端末" : "リモート"})`))],
        state.selectedVoice.get(state.speaker) || "", (value) => state.selectedVoice.set(state.speaker, value));
    }
    for (const engine of Object.keys(modelNames)) {
      const recorded = clipFor(engine, state.speaker,
        engine === "kokoro" ? line.id : line.compareAs || line.id);
      voiceCard(character, "▶ 再生", () => playClips([recorded], engine),
        { name: modelNames[engine], subtitle: `${character.name} · ${recorded.clip.voice}`, candidate: engine === "kokoro" });
    }
    voiceCard(character, "▶ 再生", () => speakTurns([{ ...line, speaker: state.speaker }], roster,
      state.selectedVoice.get(state.speaker)), { name: "ブラウザ標準",
      subtitle: browserVoice.length ? "端末で合成 · 現行の人物設定に準拠" : "端末で合成 · 英語音声の一覧は未取得" });
  }

  function go(tab, focus = false) {
    state.mode = tab.dataset.mode;
    for (const current of tabs) {
      current.setAttribute("aria-selected", current === tab);
      current.tabIndex = current === tab ? 0 : -1;
    }
    byId("lab-panel").setAttribute("aria-labelledby", tab.id);
    if (focus) tab.focus();
    resetPlayback();
    render();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => go(tab));
    tab.addEventListener("keydown", (event) => {
      const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      go(tabs[next], true);
    });
  });
  synth?.addEventListener("voiceschanged", () => {
    if (state.mode === "models" && !comparison.contains(document.activeElement)) render();
  });
  render();
  setupBenchmark(lines, profiles, { byId, element });
}

async function loadLab() {
  if (globalThis.VOICE_LAB_BUNDLE) return globalThis.VOICE_LAB_BUNDLE;
  const paths = ["corpus.json", "profiles.json", "kokoro-clips.json", "supertonic-clips.json", "../../data/characters.json"];
  const [corpus, profiles, kokoro, supertonic, characters] = await Promise.all(paths.map(async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }));
  return { corpus, profiles, clips: { kokoro: kokoro.clips, supertonic: supertonic.clips }, characters };
}

loadLab().then(setupLab).catch((error) => {
  comparison.textContent = `試聴データを読み込めませんでした。配布版HTML、またはリポジトリのHTTPプレビューを開いてください。（${error.message}）`;
});
