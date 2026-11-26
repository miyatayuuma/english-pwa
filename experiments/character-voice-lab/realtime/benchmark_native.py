"""Same Kokoro q8 weights, voices and public short text in native desktop ORT."""
import argparse
import json
from pathlib import Path
import platform
import resource
import sys
from tempfile import TemporaryDirectory
import time

import numpy as np
import onnxruntime as ort
import psutil
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent
LAB = ROOT.parent


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--dtype", choices=("q8", "q4", "fp32"), default="q8")
    parser.add_argument("--quality", action="store_true", help="Run additional US/UK, question and prosody samples")
    args = parser.parse_args()
    runtime = load(ROOT / "runtime.json")
    profiles = load(LAB / "profiles.json")
    voices = {voice["id"]: voice for voice in profiles["voices"]}
    public_short = load(ROOT / "scenarios.json")["short"][0]
    corpus = {line["id"]: line for line in load(LAB / "corpus.json")["utterances"]}
    curated = {**corpus["read-curated"], "speaker": "jennifer"}
    trials = [public_short] * 6 + [curated]
    if args.quality:
        for speaker in ("bob", "jennifer", "ted"):
            trials.extend({**corpus[line], "speaker": speaker} for line in ("everyday", "question", "connected"))
    paths = args.site / "assets"
    model = paths / "models" / runtime["model"] / "onnx" / runtime["weights"][args.dtype]
    clock = time.perf_counter
    start = clock()
    with TemporaryDirectory() as scratch:
        vectors = {voice["voice"]: np.fromfile(paths / "voices" / f"{voice['voice']}.bin", dtype="<f4")
                   .reshape(510, 1, 256) for voice in voices.values()}
        voice_pack = Path(scratch) / "voices.npz"
        np.savez(voice_pack, **vectors)
        options = ort.SessionOptions()
        options.intra_op_num_threads = args.threads
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
        kokoro = Kokoro.from_session(session, str(voice_pack))
        init_ms = (clock() - start) * 1000
        before = psutil.Process().memory_info().rss
        rows = []
        for index, line in enumerate(trials):
            voice = voices[line["speaker"]]
            started = clock()
            phonemes = line.get("kokoroPhonemes") or kokoro.tokenizer.phonemize(line["text"], voice["accent"])
            samples, rate = kokoro.create(phonemes, voice["voice"], speed=voice["speed"], lang=voice["accent"],
                                          is_phonemes=True, trim=False)
            elapsed = (clock() - started) * 1000
            frames = np.pad(samples, (0, (-len(samples)) % (rate // 100))).reshape(-1, rate // 100)
            audible = np.flatnonzero(np.mean(frames ** 2, axis=1) > 0.00001)
            if not audible.size:
                raise ValueError("Silent audio")
            trimmed = (min(len(samples), (audible[-1] + 12) * (rate // 100))
                       - max(0, (audible[0] - 7) * (rate // 100))) / rate
            rows.append({"text": line["text"], "phonemes": phonemes, "voice": voice["voice"], "warm": index > 0,
                         "synthesisMs": elapsed, "rawSeconds": len(samples) / rate, "audioSeconds": trimmed,
                         "rtf": elapsed / 1000 / trimmed, "peak": float(np.max(np.abs(samples))),
                         "rmsDbfs": float(20 * np.log10(np.sqrt(np.mean(samples ** 2)))),
                         "clippedSamples": int(np.count_nonzero(np.abs(samples) >= 1))})
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        print(json.dumps({"platform": platform.platform(), "runtime": ort.__version__, "device": "desktop-native-cpu",
                          "weights": args.dtype, "threads": args.threads, "modelRevision": runtime["revision"],
                          "profileVersion": profiles["version"], "initMs": init_ms, "residentBytes": before,
                          "peakRssBytes": peak if sys.platform == "darwin" else peak * 1024, "rows": rows}, indent=2))


if __name__ == "__main__":
    main()
