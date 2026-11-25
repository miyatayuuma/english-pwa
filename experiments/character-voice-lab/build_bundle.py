"""Build one offline audition HTML from the public checkout and verified MP3s."""
import argparse
import base64
from io import BytesIO
import json
from pathlib import Path
import re

from PIL import Image, ImageOps
from generate import ROOT, digest, read_json


def data_url(mime, contents):
    return f"data:{mime};base64,{base64.b64encode(contents).decode('ascii')}"


def safe_js(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def verify_inputs():
    corpus, profiles = (read_json(ROOT / name) for name in ("corpus.json", "profiles.json"))
    public = read_json(ROOT.parent.parent / "data/characters.json")
    cast = {c["id"]: c for c in public["characters"]}
    assert {p["id"] for p in profiles["voices"]} == set(cast) and len(cast) == 20
    assert len({p["voice"] for p in profiles["voices"]}) == 20
    assert all((ROOT.parent.parent / f'{c["name"]}.png').is_file() for c in cast.values())
    clips = {engine: read_json(ROOT / f"{engine}-clips.json")["clips"] for engine in ("kokoro", "supertonic")}
    from generate import jobs
    for engine, table in clips.items():
        expected = {f'{line["speaker"]}/{line["id"]}': line for line, _ in jobs(corpus, profiles, engine, "cast")}
        assert set(expected) == set(table), (engine, set(expected) ^ set(table))
        for key, clip in table.items():
            content = (ROOT / clip["path"]).read_bytes()
            assert digest(content) == clip["audioSha256"] and clip["bytes"] == len(content), clip["path"]
            assert digest(expected[key]["text"].encode()) == clip["textSha256"], key
            assert clip["durationSeconds"] > 0.15, key
        assert {p.relative_to(ROOT).as_posix() for p in (ROOT / "audio" / engine).glob("*.mp3")} == {
            c["path"] for c in table.values()
        }
    return corpus, profiles, public, clips


def bundle(output):
    corpus, profiles, public, clips = verify_inputs()
    characters = {
        "tts_archetypes": public["tts_archetypes"],
        "characters": [{key: character[key] for key in ("id", "name", "name_ja", "tts")}
                       for character in public["characters"]],
    }
    portraits = {}
    for character in characters["characters"]:
        buf = BytesIO()
        with Image.open(ROOT.parent.parent / f'{character["name"]}.png') as photo:
            ImageOps.fit(photo.convert("RGB"), (160, 160)).save(buf, format="WEBP", quality=82)
        portraits[character["id"]] = data_url("image/webp", buf.getvalue())

    embedded_clips = {
        engine: {key: {"voice": clip["voice"],
                       "url": data_url("audio/mpeg", (ROOT / clip["path"]).read_bytes())}
                 for key, clip in table.items()}
        for engine, table in clips.items()
    }
    data = {"corpus": corpus, "profiles": profiles, "clips": embedded_clips, "characters": characters,
            "portraits": portraits}
    html = (ROOT / "index.html").read_text()
    css = (ROOT / "lab.css").read_text()
    lab = (ROOT / "lab.js").read_text().replace('import { setupBenchmark } from "./benchmark-ui.js";\n', "", 1)
    ui = (ROOT / "benchmark-ui.js").read_text().replace("export { setupBenchmark };", "")
    worker = (ROOT / "benchmark-worker.js").read_text()
    combined = (f"globalThis.VOICE_LAB_BUNDLE = {safe_js(data)};\n"
                f"globalThis.VOICE_LAB_WORKER = {safe_js(worker)};\n{ui}\n{lab}")
    html = html.replace('<link rel="stylesheet" href="lab.css">', f"<style>\n{css}</style>")
    assert not re.search(r"</script", combined, re.IGNORECASE)
    html = html.replace('<script type="module" src="lab.js"></script>', f"<script>\n{combined}\n</script>")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    print(f"{output} · {len(portraits)} portraits · {sum(map(len, clips.values()))} MP3 files")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, nargs="?")
    args = parser.parse_args()
    if args.output:
        bundle(args.output)
    else:
        _, _, _, clips = verify_inputs()
        print({engine: len(table) for engine, table in clips.items()})
