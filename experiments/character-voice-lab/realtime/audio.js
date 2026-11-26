export class KokoroWorker {
  constructor(progress, worker = new Worker("./worker.js", { name: "kokoro", type: "module" })) {
    this.worker = worker;
    this.serial = 0;
    worker.onmessage = ({ data }) => {
      if (data.progress) {
        progress(data.progress);
      } else if (data.id === this.pending?.id) {
        this.settle(data.error ? new Error(data.error) : null, data.result);
      }
    };
    worker.onerror = event => this.close(new Error(event.message || "Worker failed"));
  }

  settle(error, result) {
    if (!this.pending) return;
    const { resolve, reject, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(result);
  }

  request(action, data) {
    if (this.pending || this.closed) throw new Error("Kokoro Worker unavailable");
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error("Kokoro Worker timed out")), action === "init" ? 120000 : 60000);
      this.pending = { id, resolve, reject, timer };
      try {
        this.worker.postMessage({ id, action, ...data });
      } catch (error) {
        this.settle(error);
      }
    });
  }

  close(error = new DOMException("Stopped", "AbortError")) {
    this.closed = true;
    this.worker.terminate();
    this.settle(error);
  }
}

export class Playback {
  constructor(context) {
    this.context = context;
    this.pending = [];
    this.tail = 0;
  }

  async waitForSlot() {
    if (this.pending.length >= 2) await this.pending[0].done;
  }

  schedule(audio, row, signal, onStart) {
    const context = this.context;
    const buffer = context.createBuffer(1, audio.pcm.length, audio.rate);
    buffer.copyToChannel(audio.pcm, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const at = Math.max(this.tail, context.currentTime + 0.015);
    const through = at + buffer.duration;
    const previous = this.tail;
    this.tail = through;
    const entry = {};
    const scheduledAt = performance.now();
    const estimatedOutputAt = scheduledAt + (at - context.currentTime + (context.outputLatency || 0)) * 1000;
    Object.assign(row, { scheduledAt, gapMs: previous ? Math.max(0, (at - previous) * 1000) : null });
    entry.done = new Promise(resolve => {
      let timer;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        source.disconnect();
        this.pending = this.pending.filter(item => item !== entry);
        row.ended = !signal.aborted;
        resolve();
      };
      const cancel = () => {
        source.stop();
        finish();
      };
      const monitor = () => {
        if (signal.aborted) return;
        const stamp = context.getOutputTimestamp?.();
        const mapped = stamp?.performanceTime > 0;
        const estimatedStart = mapped
          ? stamp.performanceTime + (at - stamp.contextTime) * 1000
          : performance.now() + (at - context.currentTime + (context.outputLatency || 0)) * 1000;
        const remaining = estimatedStart - performance.now();
        if (remaining > 3 || context.currentTime < at) {
          timer = setTimeout(monitor, Math.max(4, Math.min(remaining, 35)));
          return;
        }
        row.playbackAt = estimatedStart;
        row.playbackClock = mapped ? "output-timestamp" : "estimated-audio-clock";
        onStart(row);
      };
      source.onended = () => {
        if (!row.playbackAt && !signal.aborted) {
          row.playbackAt = estimatedOutputAt;
          row.playbackClock = "scheduled-fallback";
          onStart(row);
        }
        finish();
      };
      signal.addEventListener("abort", cancel, { once: true });
      source.start(at);
      timer = setTimeout(monitor, 0);
    });
    this.pending.push(entry);
  }

  drain() {
    return Promise.all(this.pending.map(item => item.done));
  }
}
