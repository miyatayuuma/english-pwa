let tts;
let runtime;
let current;
const fetchAsset = self.fetch.bind(self);

self.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input, location.href);
  const voicePrefix = `https://huggingface.co/${runtime?.model}/resolve/main/voices/`;
  if (url.href.startsWith(voicePrefix)) {
    const file = url.href.slice(voicePrefix.length);
    if (!/^[a-z_]+\.bin$/.test(file)) throw new Error("Invalid voice asset");
    const response = await fetchAsset(new URL(`assets/voices/${file}`, location.href), init);
    if (!response.ok) throw new Error(`Voice asset ${file}: HTTP ${response.status}`);
    return response;
  }
  if (url.origin !== location.origin && url.protocol !== "blob:") {
    throw new Error(`Unexpected external inference asset: ${url.origin}`);
  }
  return fetchAsset(input, init);
};

function trimPadding(samples, rate) {
  const frame = Math.floor(rate * 0.01);
  let first = -1;
  let last = 0;
  for (let i = 0; i < samples.length; i += frame) {
    let sum = 0;
    const end = Math.min(i + frame, samples.length);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    if (sum / (end - i) > 0.00001) {
      if (first < 0) first = i;
      last = end;
    }
  }
  if (first < 0) throw new Error("Kokoro returned silent or invalid audio");
  const start = Math.max(0, first - 7 * frame);
  const stop = Math.min(samples.length, last + 11 * frame);
  return {
    samples: samples.slice(start, stop),
    leadingMs: 1000 * (first - start) / rate,
    trailingMs: 1000 * (stop - last) / rate,
  };
}

async function synthesize(text, voice, phonemes) {
  const options = { voice: voice.voice, speed: voice.speed };
  const started = performance.now();
  const ids = phonemes && tts.tokenizer(phonemes, { truncation: false }).input_ids;
  if (ids?.dims.at(-1) > 510) throw new Error("Phoneme sequence exceeds the Kokoro context");
  const raw = ids ? await tts.generate_from_ids(ids, options) : await tts.generate(text, options);
  const synthesisMs = performance.now() - started;
  if (raw.sampling_rate !== runtime.sampleRate || !raw.audio.length) throw new Error("Invalid Kokoro PCM");
  const { samples, leadingMs, trailingMs } = trimPadding(raw.audio, raw.sampling_rate);
  return {
    pcm: samples, rate: raw.sampling_rate, synthesisMs, leadingMs, trailingMs,
    rawSeconds: raw.audio.length / raw.sampling_rate,
    audioSeconds: samples.length / raw.sampling_rate,
  };
}

async function initialize(data) {
  const started = performance.now();
  runtime = data.runtime;
  const { KokoroTTS, env } = await import("./assets/sdk/kokoro.web.js");
  const config = data.config;
  const threads = config.device === "wasm" && self.crossOriginIsolated ? config.threads : 1;
  env.configureLocalRuntime({
    threads,
    modelPath: new URL("assets/models/", location.href).href,
    wasmPath: new URL("assets/ort/", location.href).href,
  });
  if (config.device === "webgpu" && !await navigator.gpu?.requestAdapter()) {
    throw new Error("WebGPUアダプターを取得できません");
  }
  tts = await KokoroTTS.from_pretrained(runtime.model, {
    device: config.device, dtype: config.dtype,
    progress_callback(event) {
      if (event.file && event.status === "initiate") {
        self.postMessage({ progress: event.file });
      }
    },
  });
  for (const voice of data.voices) {
    if (tts.voices[voice.voice]?.language !== voice.accent) throw new Error(`Invalid voice profile: ${voice.id}`);
  }
  return { initMs: performance.now() - started, config: { ...config, threads }, isolated: self.crossOriginIsolated };
}

self.addEventListener("message", async ({ data }) => {
  const { id, action } = data;
  if (current) {
    self.postMessage({ id, error: "Worker already has a request" });
    return;
  }
  current = id;
  try {
    const result = action === "init" ? await initialize(data) : await synthesize(data.text, data.voice, data.phonemes);
    self.postMessage({ id, result }, result.pcm ? [result.pcm.buffer] : []);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  } finally {
    current = null;
  }
});
