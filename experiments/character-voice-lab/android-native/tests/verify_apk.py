"""Verify that the signed package contains the expected libraries and locked assets."""
import hashlib
import json
from pathlib import Path
import struct
import sys
from zipfile import ZipFile

with ZipFile(Path(sys.argv[1])) as apk:
    names = set(apk.namelist())
    libs = {name for name in names if name.startswith("lib/")}
    assert libs and all(name.startswith("lib/arm64-v8a/") for name in libs), libs
    for name in ("libkokoro_g2p.so", "libonnxruntime.so", "libonnxruntime4j_jni.so"):
        assert f"lib/arm64-v8a/{name}" in libs, name

    for name in libs:
        binary = apk.read(name)
        assert binary[:6] == b"\x7fELF\x02\x01", name
        machine = struct.unpack_from("<H", binary, 18)[0]
        assert machine == 183, name
        table = struct.unpack_from("<Q", binary, 32)[0]
        entry_size, count = struct.unpack_from("<HH", binary, 54)
        loads = [struct.unpack_from("<II6Q", binary, table + index * entry_size) for index in range(count)]
        assert all(entry[-1] >= 16_384 for entry in loads if entry[0] == 1), name

    runtime = json.loads(apk.read("assets/runtime.json"))
    assert runtime["revision"] == "1939ad2a8e416c0acfeecc08a694d14ef25f2231"
    assert len(runtime["downloads"]) == 23
    for path, sha in runtime["phonemizer"]["files"].items():
        assert hashlib.sha256(apk.read(f"assets/{path}")).hexdigest() == sha, path

    profiles = json.loads(apk.read("assets/profiles.json"))
    references = json.loads(apk.read("assets/references.json"))
    assert len(profiles["voices"]) == 20
    assert len(references) == 22
    for clip in references.values():
        assert hashlib.sha256(apk.read(f"assets/{clip['asset']}")).hexdigest() == clip["audioSha256"]
    assert not any(name.endswith(".onnx") for name in names), "Models must be downloaded and verified on the device"
print("P3.7 APK contents verified")
