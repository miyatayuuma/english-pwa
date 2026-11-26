import { KokoroWorker, Playback } from "./audio.js";
import { LocalMic } from "./mic.js";
import { saveOffline } from "./offline.js";
import { distribution, pause, simulate } from "./stream.js";

const ui = Object.fromEntries([...document.querySelectorAll("[id]")].map(node => [node.id, node]));
const status = message => { ui.status.textContent = message; };
const now = () => performance.now();
const getJSON = async path => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
};
const asrEvents = [];
const runs = [];
const starts = [];
const voices = new Map();
let runtime, pack, scenarios, corpus;
let cast;
let worker;
let workerVoices = new Set();
let context;
let active;
let listening = false;
let listeningSession = 0;
let saving = false;
let reference;

const mic = new LocalMic((event, detail) => {
  asrEvents.push({ event, detail, at: now() });
  const labels = { "asr-start": `${detail === "local" ? "端末内ASR" : "標準ASR"}で聞き取り中`, "asr-speech": "発話を検出",
    "asr-final": "ASRで最終結果を受信", "asr-end": "ASR終了",
    "mic-only": "マイクで発話を検出中", "mic-speech": "マイクで発話を検出",
    "vad-armed": "声による割り込みを待機中" };
  ui.asr.textContent = labels[event] ?? `${event} · ${detail}`;
  render();
}, () => void startListening("voice"));

function controls() {
  const busy = Boolean(active || listening || saving);
  ui.backend.disabled = !pack || busy || Boolean(worker);
  ui.threads.disabled = ui.backend.value.startsWith("webgpu") || busy || Boolean(worker);
  for (const el of [ui.scenario, ui.voice, ui.vad, ui["asr-mode"]]) el.disabled = busy;
  ui.warm.disabled = !pack || busy || Boolean(worker);
  ui.release.disabled = busy || !worker;
  ui.cache.disabled = !pack || busy || !("serviceWorker" in navigator);
  ui.run.disabled = !pack || busy;
  ui.stop.disabled = !(active || listening || reference);
  ui.talk.disabled = !pack || listening || saving || !isSecureContext;
  ui.reference.disabled = !pack || busy || !comparison();
  ui.export.disabled = !runs.length && !starts.length && !asrEvents.length;
}

function config() {
  const [device, dtype] = ui.backend.value.split(":");
  return { device, dtype, threads: device === "wasm" ? Number(ui.threads.value) : 1 };
}

function comparison() {
  const id = ui.scenario.value;
  if (!["everyday", "read", "read-curated"].includes(id)) return null;
  const speaker = id === "everyday" ? ui.voice.value : "jennifer";
  return cast?.[`${speaker}/${id}`];
}

function audioContext() {
  context ??= new AudioContext({ latencyHint: "interactive" });
  return context;
}

function release() {
  worker?.close();
  worker = undefined;
  workerVoices = new Set();
}

async function ready(signal) {
  signal.throwIfAborted();
  if (worker) return;
  worker = new KokoroWorker(file => status(`読み込み中 · ${file}`));
  const attempt = { config: config(), at: now() };
  starts.push(attempt);
  try {
    Object.assign(attempt, await worker.request("init", { runtime, config: attempt.config, voices: [...voices.values()] }));
  } catch (error) {
    attempt.error = error.message;
    throw error;
  }
}

function cancel(reason) {
  if (reference) {
    reference.pause();
    reference = undefined;
  }
  if (!active) return;
  const session = active;
  if (session.report) {
    session.report.stopReason = reason;
    session.report.stopRequestedAt = now();
    session.report.workerTerminated = Boolean(worker?.pending);
  }
  session.controller.abort();
  if (worker?.pending) release();
  active = undefined;
}

function stopAll(reason = "button") {
  cancel(reason);
  mic.stop();
  listeningSession++;
  // An active SpeechRecognition session retains the lock until its end event.
  if (!mic.recognizer) listening = false;
  status("停止しました");
  controls();
}

async function startListening(trigger) {
  if (listening) return;
  const interrupted = Boolean(active || reference);
  cancel(trigger);
  listening = true;
  const owner = ++listeningSession;
  asrEvents.push({ event: "interruption", trigger, interrupted, asrMode: ui["asr-mode"].value, at: now() });
  status("マイクの案内を待って「Give me a minute.」と話してください。");
  controls();
  const finish = () => { listening = false; controls(); };
  try {
    const audio = audioContext();
    await audio.resume();
    if (owner !== listeningSession) return;
    const quietMs = Math.max(100, 30 + (audio.baseLatency + (audio.outputLatency || 0)) * 1000);
    await mic.listen(audio, quietMs, finish, ui["asr-mode"].value);
  } catch (error) {
    if (owner !== listeningSession) return;
    ui.asr.textContent = error.message;
    asrEvents.push({ event: "mic-error", at: now(), detail: error.name });
    finish();
  }
}

async function synthesize(chunk, row, signal) {
  signal.throwIfAborted();
  const voice = voices.get(chunk.speaker);
  row.warmVoice = workerVoices.has(voice.voice);
  row.synthesisRequestedAt = now();
  const { pcm, rate, audioSeconds, rawSeconds, synthesisMs, leadingMs, trailingMs } = await worker.request("synth", {
    text: chunk.text, voice, phonemes: chunk.kokoroPhonemes,
  });
  signal.throwIfAborted();
  workerVoices.add(voice.voice);
  Object.assign(row, { synthesisMs, audioSeconds, rawSeconds, leadingMs, trailingMs,
    rawRtf: synthesisMs / (1000 * rawSeconds), rtf: synthesisMs / (1000 * audioSeconds),
    pcmReadyAt: now() });
  return { pcm, rate };
}

async function playTurns(turns, report, signal, tokenMs) {
  const playback = new Playback(context);
  const queue = [];
  let done = false;
  let wake;
  const notify = () => wake?.();
  signal.addEventListener("abort", notify);
  const producer = (async () => {
    for await (const chunk of simulate(turns, signal, tokenMs)) {
      queue.push(chunk);
      notify();
    }
  })().finally(() => { done = true; notify(); });
  // Any producer failure is also awaited before leaving this batch.
  producer.catch(() => {});
  try {
    while (!signal.aborted && (!done || queue.length)) {
      if (!queue.length) await new Promise(resolve => { wake = resolve; });
      if (!queue.length || signal.aborted) continue;
      await playback.waitForSlot();
      signal.throwIfAborted();
      const chunk = queue.shift();
      const row = { speaker: chunk.speaker, text: chunk.text, receivedAt: chunk.receivedAt,
        phonemeOverride: Boolean(chunk.kokoroPhonemes) };
      report.rows.push(row);
      const audio = await synthesize(chunk, row, signal);
      playback.schedule(audio, row, signal, started => {
        started.synthesisToPlaybackMs = started.playbackAt - started.synthesisRequestedAt;
        started.arrivalToPlaybackMs = started.playbackAt - started.receivedAt;
        ui.line.textContent = `${voices.get(started.speaker).name} · ${started.text}`;
        render();
      });
    }
    await playback.drain();
  } finally {
    await producer;
    signal.removeEventListener("abort", notify);
  }
}

async function jsMemory() {
  if (!performance.measureUserAgentSpecificMemory) return null;
  // Chromium may wait for a future GC. Keep this outside synthesis timing.
  try {
    return await Promise.race([performance.measureUserAgentSpecificMemory().then(result => result.bytes), pause(750).then(() => null)]);
  } catch {
    return null;
  }
}

async function run(prepareOnly = false) {
  if (active || listening) return;
  cancel();
  const controller = new AbortController();
  const { signal } = controller;
  const session = { controller };
  active = session;
  const scenario = ui.scenario.value;
  const report = { scenario, startedAt: now(), modelAlreadyResident: Boolean(worker), config: config(), rows: [] };
  if (!prepareOnly) {
    runs.push(report);
    session.report = report;
  }
  ui.line.textContent = "";
  controls();
  try {
    await audioContext().resume();
    signal.throwIfAborted();
    if (session.report) {
      report.memoryBefore = performance.memory?.usedJSHeapSize ?? null;
      report.agentMemoryBefore = await jsMemory();
    }
    status("モデルを準備中");
    await ready(signal);
    signal.throwIfAborted();
    if (prepareOnly) {
      const prime = {};
      await synthesize(scenarios.short[0], prime, signal);
      const { synthesisMs } = prime;
      starts.at(-1).primeMs = synthesisMs;
      status(`準備完了 · 初期化 ${Math.round(starts.at(-1).initMs)} ms · 初回合成 ${Math.round(synthesisMs)} ms`);
    } else {
      if (ui.vad.checked) await mic.armBargeIn(context);
      signal.throwIfAborted();
      status("発話を受信・合成中");
      const fixture = comparison();
      if (scenario === "short") {
        for (let i = 0; i < 5; i++) await playTurns(scenarios.short, report, signal, 0);
      } else if (scenario === "endurance") {
        const until = now() + 600000;
        do { await playTurns(scenarios.dialogue, report, signal, 45); } while (!signal.aborted && now() < until);
      } else if (fixture) {
        const line = corpus.get(fixture.lineId);
        await playTurns([{ ...line, speaker: fixture.speakerId }], report, signal, 0);
      } else {
        await playTurns(scenarios.dialogue, report, signal, 45);
      }
      signal.throwIfAborted();
      report.complete = true;
      report.endedAt = now();
      status(`完了 · ${report.rows.length}発話`);
    }
  } catch (error) {
    controller.abort();
    if (!report.stopReason && active === session) {
      report.error = error.message;
      if (prepareOnly && starts.at(-1)?.initMs != null) starts.at(-1).primeError = error.message;
      release();
      status(`試験エラー · ${error.message}`);
    }
  } finally {
    if (active === session) {
      mic.stop();
      active = undefined;
    }
    report.endedAt ??= now();
    if (session.report) {
      report.memoryAfter = performance.memory?.usedJSHeapSize ?? null;
      if (report.complete) report.agentMemoryAfter = await jsMemory();
    }
    render();
  }
}

function summarize(report) {
  const played = report.rows.filter(row => Number.isFinite(row.playbackAt));
  const warm = played.filter(row => row.warmVoice);
  const gaps = played.slice(1).flatMap((row, index) => {
    if (row.gapMs === null) return [];
    return [row.gapMs + played[index].trailingMs + row.leadingMs];
  });
  return {
    firstSynthesisToPlaybackMs: played[0]?.synthesisToPlaybackMs ?? null,
    firstArrivalToPlaybackMs: played[0]?.arrivalToPlaybackMs ?? null,
    warmSynthesisToPlaybackMs: distribution(warm.map(row => row.synthesisToPlaybackMs)),
    rtf: distribution(played.map(row => row.rtf)),
    interUtteranceSilenceMs: distribution(gaps),
    generationDuringPlayback: played.filter((row, i) => (
      i > 0 && row.gapMs !== null && row.pcmReadyAt > played[i - 1].playbackAt
      && row.synthesisRequestedAt < played[i - 1].playbackAt + played[i - 1].audioSeconds * 1000
    )).length,
    played: played.length,
  };
}

function render() {
  controls();
  const report = runs.at(-1);
  const result = report && summarize(report);
  const milliseconds = value => value == null ? "—" : `${Math.round(value)} ms`;
  const rows = [
    ["モデル初期化", milliseconds(starts.at(-1)?.initMs)],
    ["初音声 · 合成要求から", milliseconds(result?.firstSynthesisToPlaybackMs)],
    ["ウォーム · p50 / p95", result?.warmSynthesisToPlaybackMs
      ? [result.warmSynthesisToPlaybackMs.p50, result.warmSynthesisToPlaybackMs.p95].map(milliseconds).join(" / ") : "—"],
    ["RTF · p50 / p95", result?.rtf ? `${result.rtf.p50.toFixed(3)} / ${result.rtf.p95.toFixed(3)}` : "—"],
    ["発話間の無音 · p95", milliseconds(result?.interUtteranceSilenceMs?.p95)],
    ["再生と合成の重なり", result ? `${result.generationDuringPlayback} 回` : "—"],
  ];
  ui.summary.replaceChildren(...rows.flatMap(([label, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    return [dt, dd];
  }));
}

ui.warm.onclick = () => void run(true);
ui.run.onclick = () => void run();
ui.stop.onclick = () => stopAll();
ui.release.onclick = () => { release(); status("モデルを解放しました"); controls(); };
ui.talk.onclick = () => void startListening("push-to-talk");
ui.scenario.onchange = controls;
ui.reference.onclick = async () => {
  cancel();
  const id = ui.scenario.value;
  const fixture = comparison();
  const element = new Audio(`cast/${fixture.speakerId}-${id}.mp3`);
  reference = element;
  element.onended = () => { if (reference === element) reference = undefined; controls(); };
  controls();
  try {
    await element.play();
    if (reference === element) ui.line.textContent = `${voices.get(fixture.speakerId).name} · ${fixture.text}`;
  } catch (error) {
    if (reference !== element) return;
    reference = undefined;
    status(error.message);
    controls();
  }
};
ui.cache.onclick = async () => {
  saving = true;
  controls();
  try {
    const { dtype } = config();
    await saveOffline(pack, dtype, (current, total) => { ui.storage.textContent = `端末に保存中 · ${current} / ${total}`; });
    ui.storage.textContent = `${dtype} を端末に保存しました。通信を切って再読み込みできます。`;
  } catch (error) {
    ui.storage.textContent = `保存できませんでした · ${error.message}`;
  } finally {
    saving = false;
    controls();
  }
};
ui.install.onclick = async () => {
  ui.install.disabled = true;
  try {
    const availability = await mic.availability();
    const installed = availability === "available" || (["downloadable", "downloading"].includes(availability) && await mic.install());
    if (installed) ui["asr-mode"].value = "local";
    ui.asr.textContent = installed ? "英語の端末内認識を利用できます" : "端末内認識を準備できませんでした";
    ui.install.hidden = installed;
  } catch (error) {
    ui.asr.textContent = error.message;
  } finally {
    ui.install.disabled = false;
  }
};
ui.export.onclick = () => {
  const report = { format: "kokoro-realtime-v1", exportedAt: new Date().toISOString(), runtime, pack: pack.id,
    environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory ?? null, online: navigator.onLine, isolated: crossOriginIsolated,
      sampleRate: context?.sampleRate, baseLatency: context?.baseLatency, outputLatency: context?.outputLatency },
    starts, runs: runs.map(entry => ({ ...entry, summary: summarize(entry) })), asrEvents };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `kokoro-p36-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (active || listening || reference)) stopAll("hidden");
});

try {
  const [loaded, profile, source, fixtures, references] = await Promise.all([
    getJSON("pack.json"), getJSON("cast/profiles.json"), getJSON("cast/corpus.json"),
    getJSON("scenarios.json"), getJSON("cast/references.json"),
  ]);
  runtime = await getJSON("runtime.json");
  if (profile.version !== runtime.profileVersion || profile.voices.length !== 20) throw new Error("音声プロフィールの版が一致しません");
  for (const voice of profile.voices) {
    const name = voice.id.split("_").map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
    voices.set(voice.id, { ...voice, name });
    ui.voice.add(new Option(`${name} · ${voice.accent} · ${voice.speed.toFixed(2)}×`, voice.id));
  }
  corpus = new Map(source.utterances.map(line => [line.id, line]));
  cast = references;
  scenarios = fixtures;
  pack = loaded;
  for (const option of ui.backend.options) {
    const [device, dtype] = option.value.split(":");
    option.disabled = !pack.dtypes.includes(dtype) || (device === "webgpu" && !navigator.gpu);
  }
  const availableThreads = crossOriginIsolated ? navigator.hardwareConcurrency : 1;
  for (const option of ui.threads.options) option.disabled = Number(option.value) > availableThreads;
  ui.threads.value = availableThreads >= 4 ? "4" : availableThreads >= 2 ? "2" : "1";
  ui.capabilities.textContent = `${crossOriginIsolated ? "スレッド分離あり" : "WASMは1スレッド"} · WebGPU ${navigator.gpu ? "候補あり" : "非対応"}`;
  ui.asr.textContent = "標準ASRではブラウザが音声を外部サービスに送る場合があります。試験文は「Give me a minute.」です。";
  if (!mic.supportsLocalApi) ui["asr-mode"].querySelector('[value="local"]').disabled = true;
  if (!mic.supportsBrowserApi) ui["asr-mode"].querySelector('[value="browser"]').disabled = true;
  ui.install.hidden = !mic.supportsLocalApi;
  status("モデルを準備、または合成を開始できます");
} catch (error) {
  status(`試験パックを読み込めません · ${error.message}`);
}
render();
