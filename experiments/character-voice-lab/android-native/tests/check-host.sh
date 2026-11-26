#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../app/src/main/java/jp/miyatayuuma/kokorop37"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
javac --release 17 -d "$out" "$src"/{Pcm,StreamBuffer,LabRun}.java "$here/HostChecks.java"
java -cp "$out" jp.miyatayuuma.kokorop37.HostChecks
