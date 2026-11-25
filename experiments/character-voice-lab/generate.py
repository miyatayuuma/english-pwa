"""Generate the original voice-lab corpus. No credentials or application data are needed."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import platform
import statistics
import subprocess
import time

import numpy as np
import psutil

ROOT = Path(__file__).resolve().parent
MODELS = {
    "kokoro": ("onnx-community/Kokoro-82M-v1.0-ONNX", "1939ad2a8e416c0acfeecc08a694d14ef25f2231"),
    "supertonic": ("Supertone/supertonic-3", "3cadd1ee6394adea1bd021217a0e650ede09a323"),
}
ENCODING = "mp3-mono24k-64k-rms20-v1"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def config_digest(value):
    return digest(json.dumps(value, sort_keys=True, ensure_ascii=False).encode())


def fetch(cache, engine, remote, local=None):
    destination = cache / engine / (local or remote)
    if destination.is_file() and destination.stat().st_size:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = destination.with_suffix(destination.suffix + ".partial")
    repo, revision = MODELS[engine]
    subprocess.run(
        ["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2",
         "--max-time", "240", "--output", str(pending),
         f"https://huggingface.co/{repo}/resolve/{revision}/{remote}?download=true"],
        check=True,
    )
    pending.replace(destination)
    return destination


def jobs(corpus, profiles, engine, stage):
    voices = {voice["id"]: voice for voice in profiles["voices"]}
    common = set(corpus["common"])
    pilot = set(corpus["pilot"])
    for speaker, voice in voices.items():
        if stage == "pilot" and speaker not in profiles["pilot"]:
            continue
        if engine == "supertonic" and speaker not in profiles["pilot"]:
            continue
        for line in corpus["utterances"]:
            if engine == "supertonic" and line.get("compareAs"):
                continue
            in_pilot = speaker in profiles["pilot"] and line["id"] in pilot
            if in_pilot or (stage == "cast" and line["id"] in common):
                yield {**line, "speaker": speaker}, voice
    if stage == "cast":
        for dialogue in corpus["dialogues"]:
            if engine == "supertonic" and any(turn["speaker"] not in profiles["pilot"] for turn in dialogue["turns"]):
                continue
            for index, turn in enumerate(dialogue["turns"], 1):
                yield {**turn, "id": f'{dialogue["id"]}-{index}'}, voices[turn["speaker"]]


def engine_runner(cache, engine, voice_ids, threads):
    if engine == "kokoro":
        from kokoro_onnx import Kokoro
        from onnxruntime import InferenceSession, SessionOptions

        remote = "onnx/model_quantized.onnx"
        weights = fetch(cache, engine, remote, "model_quantized.onnx")
        config = fetch(cache, engine, "config.json")
        vectors = {}
        for voice_id in voice_ids:
            location = fetch(cache, engine, f"voices/{voice_id}.bin")
            vectors[voice_id] = np.fromfile(location, dtype="<f4").reshape(510, 1, 256)
        voice_pack = cache / engine / "voices.npz"
        np.savez(voice_pack, **vectors)
        options = SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        model = Kokoro.from_session(
            InferenceSession(str(weights), sess_options=options, providers=["CPUExecutionProvider"]),
            str(voice_pack),
        )

        def synth(line, voice, voice_id, seed):
            phonemes = line.get("kokoroPhonemes") or model.tokenizer.phonemize(line["text"], voice["accent"])
            audio, rate = model.create(phonemes, voice_id, speed=voice["speed"],
                                       lang=voice["accent"], is_phonemes=True, trim=False)
            return audio, rate, phonemes

        return synth, [weights, config, *(cache / engine / f"voices/{v}.bin" for v in voice_ids)]

    from supertonic import TTS

    names = ["duration_predictor.onnx", "text_encoder.onnx", "vector_estimator.onnx", "vocoder.onnx",
             "tts.json", "unicode_indexer.json"]
    files = [fetch(cache, engine, f"onnx/{name}") for name in names]
    files += [fetch(cache, engine, "config.json")]
    files += [fetch(cache, engine, f"voice_styles/{voice_id}.json") for voice_id in voice_ids]
    model = TTS(model="supertonic-3", model_dir=cache / engine, auto_download=False,
                intra_op_num_threads=threads, inter_op_num_threads=1)
    styles = {voice_id: model.get_voice_style(voice_id) for voice_id in voice_ids}

    def synth(line, voice, voice_id, seed):
        np.random.seed(seed)  # Supertonic's initial noise uses NumPy's global RNG.
        audio, _ = model.synthesize(line["text"], styles[voice_id], lang="en",
                                    total_steps=8, speed=voice["speed"])
        return audio, model.sample_rate, None

    return synth, files


def encode(path, samples, rate):
    samples = np.asarray(samples, dtype=np.float32).ravel()
    if not samples.size or not np.isfinite(samples).all():
        raise ValueError("Missing or non-finite waveform")
    # Use short frame RMS so individual noise spikes do not define the speech boundaries.
    frame = max(1, int(rate * 0.01))
    pad = (-samples.size) % frame
    frames = np.pad(samples, (0, pad)).reshape(-1, frame)
    active = np.flatnonzero(np.sqrt(np.mean(frames ** 2, axis=1)) >= 10 ** (-48 / 20))
    if not active.size:
        raise ValueError("Waveform is silent")
    start, end = int(active[0]) * frame, min(samples.size, (int(active[-1]) + 1) * frame)
    trimmed = np.pad(samples[max(0, start - 4 * frame):end + 6 * frame], (4 * frame, 8 * frame))
    rms = float(np.sqrt(np.mean(frames[active] ** 2)))
    gain = min(0.1 / rms, 10 ** (-1.5 / 20) / float(np.max(np.abs(trimmed))))
    pending = path.with_suffix(".partial.mp3")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(rate), "-ac", "1",
         "-i", "-", "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "64k",
         "-map_metadata", "-1", str(pending)],
        input=(trimmed * gain).astype("<f4").tobytes(), check=True,
    )
    pending.replace(path)
    return len(samples) / rate, len(trimmed) / rate, 20 * math.log10(gain)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", choices=MODELS)
    parser.add_argument("--stage", choices=["pilot", "cast"], default="cast")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/english-pwa-tts")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    cache = args.cache.resolve()
    corpus, profiles = (read_json(ROOT / name) for name in ("corpus.json", "profiles.json"))
    target = ROOT / "audio" / args.engine
    target.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / f"{args.engine}-clips.json"
    previous = read_json(manifest_path)["clips"] if manifest_path.exists() else {}
    result = {}
    pending = []
    for line, voice in jobs(corpus, profiles, args.engine, args.stage):
        speaker, line_id = line["speaker"], line["id"]
        voice_id = voice["voice"] if args.engine == "kokoro" else profiles["pilot"][speaker]
        text_sha = digest(line["text"].encode())
        revision = MODELS[args.engine][1]
        identity = {
            "corpusId": corpus["version"], "lineId": line_id, "speakerId": speaker,
            "textSha256": text_sha, "profileVersion": profiles["version"],
            "model": args.engine, "modelRevision": revision, "voice": voice_id,
            "locale": voice["accent"] if args.engine == "kokoro" else "en",
            "speed": voice["speed"], "encoding": ENCODING,
        }
        if "kokoroPhonemes" in line:
            identity["phonemeOverrideSha256"] = digest(line["kokoroPhonemes"].encode())
        identity_sha = config_digest(identity)
        filename = f"{speaker}--{line_id}--{identity_sha[:12]}.mp3"
        key = f"{speaker}/{line_id}"
        path = target / filename
        old = previous.get(key, {})
        if not args.force and old.get("identitySha256") == identity_sha and path.is_file():
            if old.get("audioSha256") == digest(path.read_bytes()):
                result[key] = old
                continue
        pending.append((key, path, line, voice, voice_id, identity, identity_sha))
    if not pending:
        print(f"{args.engine}: reused all {len(result)} verified clips")
        return

    before = time.perf_counter()
    synth, model_files = engine_runner(cache, args.engine, sorted({job[4] for job in pending}), args.threads)
    model_prep_seconds = time.perf_counter() - before
    times = []
    post_times = []
    audio_seconds = []
    for key, path, line, voice, voice_id, identity, identity_sha in pending:
        before = time.perf_counter()
        samples, rate, phonemes = synth(line, voice, voice_id, int(identity_sha[:8], 16))
        elapsed = time.perf_counter() - before
        after_synth = time.perf_counter()
        raw_secs, padded_secs, gain = encode(path, samples, rate)
        post_times.append(time.perf_counter() - after_synth)
        times.append(elapsed)
        audio_seconds.append(raw_secs)
        print(f"{args.engine:10s} {key:32s} {elapsed:5.3f} s / {raw_secs:5.3f} s", flush=True)
        result[key] = {**identity, "identitySha256": identity_sha, "text": line["text"],
                       "path": path.relative_to(ROOT).as_posix(), "audioSha256": digest(path.read_bytes()),
                       "bytes": path.stat().st_size, "durationSeconds": round(padded_secs, 3),
                       "appliedGainDb": round(gain, 2)}
        if phonemes is not None:
            result[key]["phonemes"] = phonemes
        # Preserve already completed work if a later clip fails.
        write_json(manifest_path, {"clips": {**previous, **result}})

    retained = previous if args.stage == "pilot" else {}
    write_json(manifest_path, {"clips": dict(sorted({**retained, **result}.items()))})
    import resource
    metrics = {
        "stage": args.stage, "engine": args.engine, "threads": args.threads,
        "runtime": platform.platform(), "logicalCpuAffinity": len(psutil.Process().cpu_affinity()),
        "ort": __import__("onnxruntime").__version__,
        "generated": len(times), "reused": len(result) - len(times),
        "setupSecondsIncludingCacheAccess": round(model_prep_seconds, 3),
        "synthesisSeconds": round(sum(times), 3), "audioSecondsBeforeTrim": round(sum(audio_seconds), 3),
        "encodingSeconds": round(sum(post_times), 3),
        "medianClipSeconds": round(statistics.median(times), 3),
        "p95ClipSeconds": round(sorted(times)[math.ceil(0.95 * len(times)) - 1], 3),
        "aggregateRtf": round(sum(times) / sum(audio_seconds), 4),
        "peakProcessRssMiB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        "loadedModelAssetBytes": sum(path.stat().st_size for path in model_files),
        "modelAndVoiceAssets": {
            path.relative_to(cache / args.engine).as_posix():
                {"bytes": path.stat().st_size, "sha256": file_digest(path)}
            for path in model_files
        },
    }
    write_json(ROOT / f"{args.engine}-{args.stage}-measurements.json", metrics)


if __name__ == "__main__":
    main()
