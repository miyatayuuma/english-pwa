import { pause } from "./stream.js";

const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const BrowserRecognition = window.webkitSpeechRecognition ?? Recognition;
const language = "en-US";

export class LocalMic {
  constructor(onEvent, onBargeIn) {
    this.onEvent = onEvent;
    this.onBargeIn = onBargeIn;
    this.generation = 0;
  }

  get supportsLocalApi() {
    return Boolean(!/HeadlessChrome|Android/.test(navigator.userAgent) && Recognition?.available
      && "processLocally" in Recognition.prototype);
  }

  get supportsBrowserApi() {
    return Boolean(BrowserRecognition);
  }

  async availability() {
    if (!this.supportsLocalApi) return "unsupported";
    try {
      return await Recognition.available({ langs: [language], processLocally: true });
    } catch {
      return "unsupported";
    }
  }

  async install() {
    if (!Recognition?.install) return false;
    return Recognition.install({ langs: [language], processLocally: true });
  }

  stop() {
    this.generation++;
    this.disconnectMonitor();
    this.recognizer?.abort();
  }

  disconnectMonitor() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.source?.disconnect();
    this.source = undefined;
    clearInterval(this.monitor);
    this.monitor = undefined;
  }

  async listen(context, quietMs, onEnd, mode) {
    this.stop();
    const generation = this.generation;
    // Wait for the output buffer to drain after stopping playback.
    await pause(quietMs);
    if (generation !== this.generation) return;
    const local = mode === "local" && await this.availability() === "available";
    const browser = mode === "browser" && this.supportsBrowserApi;
    if (generation !== this.generation) return;
    if (local || browser) {
      const recognition = local ? new Recognition() : new BrowserRecognition();
      recognition.lang = language;
      if (local) recognition.processLocally = true;
      recognition.interimResults = false;
      this.recognizer = recognition;
      const timeout = setTimeout(() => recognition.abort(), 10000);
      const finish = () => {
        clearTimeout(timeout);
        this.recognizer = undefined;
        onEnd();
      };
      recognition.onstart = () => this.onEvent("asr-start", mode);
      recognition.onspeechstart = () => this.onEvent("asr-speech");
      recognition.onresult = event => {
        if (event.results[event.resultIndex]?.isFinal) this.onEvent("asr-final");
      };
      recognition.onerror = event => this.onEvent("asr-error", event.error);
      recognition.onend = () => {
        this.onEvent("asr-end");
        finish();
      };
      try {
        recognition.start();
      } catch (error) {
        finish();
        throw error;
      }
      return;
    }
    const stream = await this.open(generation);
    if (!stream) return;
    this.onEvent("mic-only", mode);
    this.analyze(context, () => this.onEvent("mic-speech"), { once: true });
    await pause(5000);
    if (generation !== this.generation) return;
    this.disconnectMonitor();
    onEnd();
  }

  async armBargeIn(context) {
    this.stop();
    const generation = this.generation;
    if (!await this.open(generation)) return;
    this.onEvent("vad-armed");
    this.analyze(context, this.onBargeIn, { once: true, startupMs: 300, threshold: 0.025 });
  }

  async open(generation) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("マイクにはHTTPSまたはlocalhostが必要です");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach(track => track.stop());
      return null;
    }
    this.stream = stream;
    return stream;
  }

  analyze(context, detected, { once, startupMs = 100, threshold = 0.018 }) {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    this.source = context.createMediaStreamSource(this.stream);
    this.source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let frames = 0;
    this.monitor = setInterval(() => {
      if (performance.now() - started < startupMs) return;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
      frames = rms >= threshold ? frames + 1 : 0;
      if (frames < 3) return;
      frames = 0;
      if (once) clearInterval(this.monitor);
      detected();
    }, 35);
  }
}
