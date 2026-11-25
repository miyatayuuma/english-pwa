const LIBRARY = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/";
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
let tts;
let activeBackend;

const fetchAsset = self.fetch.bind(self);
// The SDK does not expose a revision option. Pin model, tokenizer and voice
// fetches together, including the separate path used by the voice SDK.
self.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  const prefix = `https://huggingface.co/${MODEL}/resolve/main/`;
  if (!url.startsWith(prefix)) return fetchAsset(input, init);
  const pinned = url.replace(prefix, `https://huggingface.co/${MODEL}/resolve/${REVISION}/`);
  return fetchAsset(input instanceof Request ? new Request(pinned, input) : pinned, init);
};

self.addEventListener("message", async ({ data }) => {
  const { backend, trials } = data;
  try {
    const fresh = !tts;
    if (activeBackend && backend !== activeBackend) throw new Error("モデルを解放してから実行方式を変更してください。");
    let initMs = 0;
    const transfer = {};
    if (fresh) {
      const start = performance.now();
      const { KokoroTTS, env } = await import(LIBRARY);
      // Use the browser SDK's own default for non-WASM backends only if provided.
      env.wasmPaths = WASM;
      tts = await KokoroTTS.from_pretrained(MODEL, {
        device: backend,
        dtype: backend === "webgpu" ? "fp32" : "q8",
        progress_callback(event) {
          if (event.file && Number.isFinite(event.total)) transfer[event.file] = event.total;
          if (event.file && event.status !== "progress") {
            self.postMessage({ type: "progress", status: event.status, file: event.file });
          }
        },
      });
      initMs = performance.now() - start;
      activeBackend = backend;
    }

    const measurements = [];
    let wav;
    for (const trial of trials) {
      const start = performance.now();
      const audio = await tts.generate(trial.text, { voice: trial.voice, speed: trial.speed });
      const inferenceMs = performance.now() - start;
      wav = audio.toWav();
      const duration = audio.audio.length / audio.sampling_rate;
      if (!(duration > 0)) throw new Error("音声が生成されませんでした。");
      measurements.push({
        id: trial.id,
        voice: trial.voice,
        inferenceMs,
        wavReadyMs: performance.now() - start,
        audioSeconds: duration,
        rtf: inferenceMs / 1000 / duration,
      });
      self.postMessage({ type: "sample", current: measurements.length, total: trials.length });
    }
    // This heap field is optional and excludes native/ORT/GPU allocations.
    const heap = performance.memory?.usedJSHeapSize ?? null;
    self.postMessage({ type: "finish", result: { fresh, runtime: LIBRARY, revision: REVISION,
      device: backend, browserUserAgent: navigator.userAgent, initMs, transfer, measurements,
      workerJsHeapBytes: heap }, wav }, [wav]);
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || String(error) });
  }
});
