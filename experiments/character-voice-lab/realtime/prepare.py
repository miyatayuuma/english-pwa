"""Build and optionally serve an isolated, local-only Pixel evaluation site."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent
LAB = ROOT.parent
FILES = (
    "index.html", "style.css", "runtime.json", "scenarios.json", "lab.js", "audio.js",
    "worker.js", "stream.js", "mic.js", "offline.js", "offline-sw.js",
)
LOCK = {
    "kokoro.web.js": "6067712fe4c43cdb36c762f860a5ab8d96ea1d9c8882466438eb9f3d0d20be8f",
    "ort-wasm-simd-threaded.jsep.mjs": "08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9",
    "ort-wasm-simd-threaded.jsep.wasm": "c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39",
    "model_quantized.onnx": "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478",
    "model_q4.onnx": "04cf570cf9c4153694f76347ed4b9a48c1b59ff1de0999e6605d123966b197c7",
    "model.onnx": "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb",
    "config.json": "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f",
    "tokenizer.json": "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34",
    "tokenizer_config.json": "be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20",
    "am_liam.bin": "52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade",
    "af_heart.bin": "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b",
    "am_onyx.bin": "da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6",
    "af_kore.bin": "9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e",
    "af_sarah.bin": "4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a",
    "am_fenrir.bin": "c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43",
    "am_santa.bin": "61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a",
    "am_echo.bin": "3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3",
    "am_puck.bin": "fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0",
    "am_eric.bin": "e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832",
    "af_nova.bin": "18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f",
    "am_michael.bin": "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1",
    "af_bella.bin": "f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b",
    "bm_george.bin": "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc",
    "af_alloy.bin": "c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45",
    "bm_fable.bin": "f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1",
    "bm_daniel.bin": "6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8",
    "af_aoede.bin": "4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361",
    "af_sky.bin": "4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9",
    "bm_lewis.bin": "b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97",
}
# The pinned SDK bundles Transformers.js and exposes only wasmPaths.
# Expose its existing environment options through a guarded, build-time adapter.
MARKER = "const Mf={set wasmPaths("
ADAPTER = """const Mf={configureLocalRuntime({ threads, modelPath, wasmPath }) {
  Wg.allowLocalModels = true;
  Wg.allowRemoteModels = false;
  Wg.useBrowserCache = false;
  Wg.localModelPath = modelPath;
  Wg.backends.onnx.wasm.numThreads = threads;
  Wg.backends.onnx.wasm.wasmPaths = wasmPath;
},set wasmPaths("""


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(item, output, cache):
    url, relative, dtype = item
    destination = output / relative
    path = cache / relative.name
    expected = LOCK[path.name]

    def valid(file):
        return file.is_file() and sha256(file) == expected

    if not valid(path):
        with TemporaryDirectory(dir=cache) as folder:
            partial_file = Path(folder) / path.name
            subprocess.run(["curl", "-fsSL", "--retry", "2", "--max-time", "300",
                            "-o", str(partial_file), url], check=True)
            if not valid(partial_file):
                raise ValueError(f"Unexpected asset checksum or size: {url}")
            partial_file.replace(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if path.name == "kokoro.web.js":
        original = path.read_text(encoding="utf-8")
        if original.count(MARKER) != 1:
            raise ValueError("Pinned Kokoro SDK adaptation point changed")
        destination.write_text(original.replace(MARKER, ADAPTER, 1), encoding="utf-8")
    else:
        shutil.copyfile(path, destination)
    return destination, dtype


def build(output, cache, dtypes):
    runtime = load(ROOT / "runtime.json")
    profile = load(LAB / "profiles.json")
    if profile["version"] != runtime["profileVersion"] or len(profile["voices"]) != 20:
        raise ValueError("P3.5 voice profile mismatch")
    model = runtime["model"]
    revision = runtime["revision"]
    onnx = f"https://huggingface.co/{model}/resolve/{revision}"
    cdn = "https://cdn.jsdelivr.net/npm"
    files = [
        (f"{cdn}/kokoro-js@{runtime['kokoroJs']}/dist/kokoro.web.js", Path("assets/sdk/kokoro.web.js"), None)
    ]
    for extension in ("mjs", "wasm"):
        name = f"ort-wasm-simd-threaded.jsep.{extension}"
        files.append((f"{cdn}/onnxruntime-web@{runtime['ortWeb']}/dist/{name}", Path("assets/ort") / name, None))
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json"):
        files.append((f"{onnx}/{name}?download=true", Path("assets/models") / model / name, None))
    for dtype in dtypes:
        name = runtime["weights"][dtype]
        files.append((f"{onnx}/onnx/{name}?download=true", Path("assets/models") / model / "onnx" / name, dtype))
    for voice in profile["voices"]:
        name = f"{voice['voice']}.bin"
        files.append((f"{onnx}/voices/{name}?download=true", Path("assets/voices") / name, None))

    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    copy = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        copy.extend(pool.map(partial(fetch, output=output, cache=cache), files))
    for name in FILES:
        shutil.copyfile(ROOT / name, output / name)
        copy.append((output / name, None))

    cast = output / "cast"
    cast.mkdir(exist_ok=True)
    for name in ("profiles.json", "corpus.json"):
        shutil.copyfile(LAB / name, cast / name)
        copy.append((cast / name, None))
    clips = load(LAB / "kokoro-clips.json")["clips"]
    references = {}
    for voice in profile["voices"]:
        speaker = voice["id"]
        lines = ["everyday", "read", "read-curated"] if speaker == "jennifer" else ["everyday"]
        for line in lines:
            key = f"{speaker}/{line}"
            clip = clips[key]
            identity = (clip["profileVersion"], clip["modelRevision"], clip["voice"], clip["locale"], clip["speed"])
            if identity != (profile["version"], revision, voice["voice"], voice["accent"], voice["speed"]):
                raise ValueError(f"Prerecorded profile mismatch: {key}")
            source = LAB / clip["path"]
            if sha256(source) != clip["audioSha256"]:
                raise ValueError(f"Prerecorded asset mismatch: {key}")
            path = cast / f"{speaker}-{line}.mp3"
            shutil.copyfile(source, path)
            copy.append((path, None))
            references[key] = {field: clip[field] for field in ("speakerId", "lineId", "text")}
    path = cast / "references.json"
    path.write_text(json.dumps(references), encoding="utf-8")
    copy.append((path, None))

    entries = [{"path": path.relative_to(output).as_posix(), "bytes": path.stat().st_size,
                "sha256": sha256(path), **({"dtype": dtype} if dtype else {})} for path, dtype in sorted(copy)]
    manifest = json.dumps(entries, sort_keys=True).encode()
    pack = {"id": hashlib.sha256(manifest).hexdigest()[:16], "dtypes": dtypes, "files": entries}
    pending = output / "pack.tmp"
    pending.write_text(json.dumps(pack, indent=2), encoding="utf-8")
    pending.replace(output / "pack.json")


class LabHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("kokoro-realtime-site"))
    parser.add_argument("--cache", type=Path, default=Path(".kokoro-realtime-cache"))
    parser.add_argument("--precision", nargs="+", choices=("q8", "q4", "fp32"), default=["q8"])
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--serve-only", action="store_true")
    args = parser.parse_args()
    if not args.serve_only:
        if args.output.resolve() in (ROOT, LAB):
            parser.error("Provide a separate output directory")
        build(args.output, args.cache, list(dict.fromkeys(["q8", *args.precision])))
    if args.serve or args.serve_only:
        if not (args.output / "pack.json").is_file():
            parser.error("Build the site first")
        mimetypes.add_type("application/javascript", ".mjs")
        mimetypes.add_type("application/wasm", ".wasm")
        with ThreadingHTTPServer(("127.0.0.1", args.port), partial(LabHandler, directory=str(args.output))) as server:
            print(f"http://127.0.0.1:{server.server_port}/", flush=True)
            server.serve_forever()


if __name__ == "__main__":
    main()
