"""Package only the pinned public P3.5/P3.6 sources needed by the Android lab."""
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import sys

LAB = Path(__file__).resolve().parent.parent
ESPEAK = "4870adfa25b1a32b4361592f1be8a40337c58d6c"
BASE = "1d3b06c830073315bbe51b78155c376aa23feeac"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def build(output):
    import espeakng_loader

    output.mkdir(parents=True, exist_ok=True)
    runtime = read(LAB / "kokoro-runtime.json")
    profiles = read(LAB / "profiles.json")
    assert len(profiles["voices"]) == 20 and profiles["version"] == runtime["profileVersion"]
    assert len({v["id"] for v in profiles["voices"]}) == 20
    assert all(v["accent"] in {"en-us", "en-gb"} and .5 <= v["speed"] <= 2 for v in profiles["voices"])
    for name in ("profiles.json", "corpus.json"):
        shutil.copyfile(LAB / name, output / name)
    shutil.copyfile(LAB / "realtime/scenarios.json", output / "scenarios.json")

    lock = runpy.run_path(str(LAB / "realtime/prepare.py"))["LOCK"]
    paths = [f"onnx/{runtime['weights'][dtype]}" for dtype in ("fp32", "q8")]
    paths += ["tokenizer.json", *(f"voices/{v['voice']}.bin" for v in profiles["voices"])]
    runtime["weights"] = {key: runtime["weights"][key] for key in ("fp32", "q8")}
    runtime["downloads"] = {path: lock[Path(path).name] for path in paths}
    runtime["baseCommit"] = BASE
    runtime["license"] = "Apache-2.0"
    runtime["ortAndroid"] = "1.22.0"
    runtime["phonemizer"] = {
        "library": "eSpeak NG 1.52.0",
        "revision": ESPEAK,
        "dataPackage": "espeakng-loader==0.2.4",
        "source": f"https://github.com/espeak-ng/espeak-ng/tree/{ESPEAK}",
        "license": "GPL-3.0-or-later",
    }

    # Copy only the language data required by the research app. The wheel uses the same eSpeak revision.
    data = Path(espeakng_loader.get_data_path())
    if (data / "espeak-ng-data").is_dir():
        data /= "espeak-ng-data"
    espeak_data = output / "espeak-ng-data"
    if espeak_data.exists():
        shutil.rmtree(espeak_data)
    (espeak_data / "lang" / "gmw").mkdir(parents=True)
    for name in ("phondata", "phonindex", "phontab", "intonations", "en_dict", "lang/gmw/en-US", "lang/gmw/en"):
        shutil.copyfile(data / name, espeak_data / name)
    runtime["phonemizer"]["files"] = {
        path.relative_to(output).as_posix(): digest(path) for path in sorted(espeak_data.rglob("*")) if path.is_file()
    }
    write(output / "runtime.json", runtime)

    clips = read(LAB / "kokoro-clips.json")["clips"]
    references = {}
    audio = output / "references"
    audio.mkdir(exist_ok=True)
    for voice in profiles["voices"]:
        speaker = voice["id"]
        lines = ["everyday", "read", "read-curated"] if speaker == "jennifer" else ["everyday"]
        for line in lines:
            key = f"{speaker}/{line}"
            clip = clips[key]
            actual = [clip[k] for k in ("profileVersion", "modelRevision", "voice", "locale", "speed")]
            assert actual == [profiles["version"], runtime["revision"], voice["voice"], voice["accent"], voice["speed"]], key
            assert digest(LAB / clip["path"]) == clip["audioSha256"], key
            asset = f"references/{speaker}-{line}.mp3"
            shutil.copyfile(LAB / clip["path"], output / asset)
            references[key] = {**clip, "asset": asset}
    write(output / "references.json", references)


if __name__ == "__main__":
    build(Path(sys.argv[1]))
