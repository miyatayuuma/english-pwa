function setupBenchmark(lines, profiles, { byId, element }) {
  const backend = byId("backend");
  const start = byId("bench-start");
  const cached = byId("bench-cached");
  const release = byId("bench-fresh");
  const save = byId("bench-export");
  const note = byId("bench-status");
  const output = byId("bench-results");
  const generated = byId("bench-audio");
  let worker;
  let outputUrl;
  let result;
  let metadata;
  let timeout;
  const voice = profiles.voices.find(({ id }) => id === "jennifer");
  const trials = ["everyday", "everyday", "long"].map((id) => ({
    id, text: lines.get(id).text, voice: voice.voice, speed: voice.speed,
  }));
  const seconds = (ms) => (ms / 1000).toFixed(2);
  const workerPath = () => globalThis.VOICE_LAB_WORKER
    ? URL.createObjectURL(new Blob([globalThis.VOICE_LAB_WORKER], { type: "text/javascript" }))
    : new URL("benchmark-worker.js", location.href).href;
  const uiBusy = (busy) => {
    start.disabled = busy || Boolean(worker);
    cached.disabled = busy || !worker;
    release.disabled = !worker;
    backend.disabled = busy || Boolean(worker);
  };
  function closeWorker() {
    clearTimeout(timeout);
    worker?.terminate();
    worker = undefined;
    uiBusy(false);
  }
  function fail(message) {
    closeWorker();
    note.textContent = `測定できませんでした。通信とブラウザ設定を確認してください。（${message}）`;
  }
  function showReport(value, wav) {
    output.replaceChildren();
    output.append(element("p", `${value.fresh ? "初回初期化" : "モデル常駐"} ${seconds(value.initMs)} 秒 · ${value.device}`));
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    for (const title of ["発話", "合成（秒）", "WAV完成（秒）", "音声長（秒）", "RTF"]) {
      const header = element("th", title);
      header.scope = "col";
      head.append(header);
    }
    const body = table.createTBody();
    for (const row of value.measurements) {
      const cells = body.insertRow();
      for (const text of [row.id, seconds(row.inferenceMs), seconds(row.wavReadyMs),
        row.audioSeconds.toFixed(2), row.rtf.toFixed(3)]) cells.insertCell().textContent = text;
    }
    output.append(table);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    generated.src = outputUrl;
    generated.hidden = false;
    save.disabled = false;
  }
  function run() {
    if (!window.Worker) {
      note.textContent = "このブラウザではWeb Workerを利用できません。";
      return;
    }
    if (backend.value === "webgpu" && !navigator.gpu) {
      note.textContent = "この環境のWebGPUは利用できません。WASM / q8 を選択できます。";
      return;
    }
    try {
      if (!worker) {
        const path = workerPath();
        try {
          worker = new Worker(path, { type: "module", name: "voice-benchmark" });
        } finally {
          if (path.startsWith("blob:")) URL.revokeObjectURL(path);
        }
        worker.onerror = (event) => fail(event.message || "Worker の起動エラー");
        worker.onmessage = ({ data }) => {
          if (data.type === "progress") note.textContent = `取得・初期化中 · ${data.file}`;
          if (data.type === "sample") note.textContent = `端末内で生成中 · ${data.current} / ${data.total}`;
          if (data.type === "error") fail(data.message);
          if (data.type === "finish") {
            clearTimeout(timeout);
            result = { ...data.result, ...metadata };
            showReport(result, data.wav);
            uiBusy(false);
            note.textContent = "測定が完了しました。";
          }
        };
      }
      metadata = { conditionNotes: byId("conditions").value.trim(), testedAt: new Date().toISOString(),
        browserOnlineAtStart: navigator.onLine, deviceMemoryGiBHint: navigator.deviceMemory ?? null,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null, crossOriginIsolated,
        requestTrials: trials, runLabel: start.disabled ? "warm" : "init" };
      note.textContent = "端末内合成を準備中。初回は時間がかかります。";
      uiBusy(true);
      timeout = setTimeout(() => fail("4分でタイムアウト"), 240_000);
      worker.postMessage({ backend: backend.value, trials });
    } catch (error) {
      fail(error.message);
    }
  }
  start.addEventListener("click", run);
  cached.addEventListener("click", run);
  release.addEventListener("click", () => {
    closeWorker();
    note.textContent = "モデルを解放しました。次の測定ではモデルを初期化します。";
  });
  save.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "voice-lab-device-measurement.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

export { setupBenchmark };
