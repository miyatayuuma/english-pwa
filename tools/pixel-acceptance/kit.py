#!/usr/bin/env python3
"""Read-only device preflight, pinned APK verification, fail-closed trace projection."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
AUTHORITY = json.loads((Path(__file__).with_name('authority.json')).read_text())

def digest(data):
    return hashlib.sha256(data).hexdigest()

def adb(args):
    # Never include stderr, device listings, serials, or command arguments in reports.
    return subprocess.run(['adb', *args], capture_output=True, text=True, timeout=15, check=True).stdout.strip()

def preflight():
    if not shutil.which('adb'):
        return {'status': 'DEVICE_UNAVAILABLE', 'reason': 'ADB_MISSING'}
    try:
        rows = [r.split() for r in adb(['devices']).splitlines()[1:] if r.strip()]
        if len(rows) != 1 or len(rows[0]) < 2 or rows[0][1] != 'device':
            return {'status': 'DEVICE_UNAVAILABLE', 'reason': 'REQUIRE_ONE_AUTHORIZED_DEVICE'}
        props = {key: adb(['shell', 'getprop', prop]) for key, prop in {
            'manufacturer': 'ro.product.manufacturer', 'model': 'ro.product.model',
            'android': 'ro.build.version.release', 'api': 'ro.build.version.sdk',
            'emulator': 'ro.kernel.qemu'}.items()}
        physical_pixel = props['manufacturer'].lower() == 'google' and props['model'].startswith('Pixel') and props['emulator'] != '1' and not rows[0][0].startswith('emulator-')
        if not physical_pixel:
            return {'status': 'DEVICE_UNAVAILABLE', 'reason': 'NOT_PHYSICAL_PIXEL'}
        # Preflight is not user authorization, install permission, or acceptance PASS.
        return {'status': 'PIXEL_DETECTED_PERMISSION_REQUIRED',
                'model': props['model'] if re.fullmatch(r'Pixel [A-Za-z0-9 +_-]{1,40}', props['model']) else 'Pixel',
                'api': int(props['api']) if props['api'].isdigit() else None,
                'android': props['android'] if re.fullmatch(r'[0-9.]{1,12}', props['android']) else None}
    except (subprocess.SubprocessError, OSError):
        return {'status': 'DEVICE_UNAVAILABLE', 'reason': 'ADB_READ_FAILED'}

def verify_apk(path, authority=AUTHORITY):
    raw = Path(path).read_bytes()
    if digest(raw) != authority['artifactZipSha256']:
        raise ValueError('Artifact ZIP hash mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if archive.namelist() != ['app-debug.apk']:
            raise ValueError('Unexpected artifact members')
        apk = archive.read('app-debug.apk')
    with zipfile.ZipFile(io.BytesIO(apk)) as archive:
        for relative in ['index.html', 'scripts/version.js', 'data/vocabulary-v3.json', 'data/items.json', 'data/characters.json']:
            # Compare exact runtime bytes to a clean pinned source checkout.
            local = ROOT / relative
            expected = subprocess.run(['git', 'show', authority['sourceSha'] + ':' + relative], cwd=ROOT, capture_output=True, check=True).stdout
            if archive.read('assets/public/' + relative) != expected:
                raise ValueError('Embedded web asset mismatch: ' + relative)
        index = archive.read('assets/public/scripts/version.js').decode()
        if authority['appVersion'] not in index:
            raise ValueError('APP_VERSION missing from embedded index')
    return {'status': 'APK_VERIFIED', 'sourceSha': authority['sourceSha'],
            'appVersion': authority['appVersion'], 'artifactId': authority['artifactId'],
            'artifactZipSha256': digest(raw), 'apkFilename': 'app-debug.apk', 'apkSha256': digest(apk)}

EVENTS = set('recognition-backend-configured recognition-start-requested recognition-started interim-result-received final-result-received terminal-recognition-completed recognition-failed recognition-cancelled candidate-evaluated candidate-selected game-grading-completed final-ui-result-committed srs-update-attempted srs-update-completed srs-update-skipped attempt-closed correction-started correction-attempt-recorded correction-completed stale-callback-observed incomplete-evidence-rejected grading-skipped'.split())
NUMBERS = set('sequence candidateRank selectedCandidateRank candidateSegment selectedCandidateSegment providerReturnedCandidateCount retainedCandidateCount requestedMaxAlternatives updateInvocationCount persistenceWriteCount score beforeLevel candidateLevel afterLevel'.split())
BOOLEANS = set('recognitionComplete transportComplete finalEvidenceReceived accepted pass rescueApplied persisted updateAttempted duplicateUpdateSuppressed correctionActive'.split())
ENUMS = {'completionState': {'idle', 'terminal', 'cancelled', 'error', 'pending'}, 'evidenceFinality': {'final', 'interim', 'mixed', 'none'}, 'backendType': {'android-native', 'web-speech'}, 'gameMode': {'Read', 'Compose', 'Vocabulary', 'Cloze', 'read', 'compose', 'vocabulary', 'cloze'}, 'finalOutcome': {'pass', 'fail'}}
DECISIONS = {'PARAPHRASE', 'TARGET', 'MISS', 'PASS', 'FAIL', 'NO_GRADE', 'no-speech', 'CORRECTION_SUCCESS', 'CORRECTION_FAILURE', 'CORRECTION_TECHNICAL_ERROR'}
IDENTITIES = ('attemptId', 'traceSessionId', 'nativeSessionId')

def identity_hashes(value):
    return {key + 'Hash': digest(str(value[key]).encode()) for key in IDENTITIES if value.get(key) is not None}

def sanitize(trace):
    if trace.get('schemaVersion') != 'asr-game-trace-export-v1' or not isinstance(trace.get('attempts'), list):
        raise ValueError('Expected existing Game Trace export')
    result = {'schemaVersion': 'pixel-safe-trace-v1', 'acceptance': 'INCONCLUSIVE', 'attempts': []}
    for i, attempt in enumerate(trace['attempts']):
        events = []
        for event in attempt.get('events', []):
            if event.get('type') not in EVENTS:
                continue
            clean = {'type': event['type'], **identity_hashes(event)}
            decision = event.get('decision')
            if isinstance(decision, dict):
                clean['decision'] = {k: v for k, v in decision.items() if (k == 'type' and isinstance(v, str) and v in DECISIONS) or (k == 'pass' and type(v) is bool)}
            for key in NUMBERS:
                value = event.get(key)
                if type(value) in (int, float) and -1 <= value <= 1000000:
                    clean[key] = value
            for key in BOOLEANS:
                if type(event.get(key)) is bool:
                    clean[key] = event[key]
            for key, allowed in ENUMS.items():
                if isinstance(event.get(key), str) and event[key] in allowed:
                    clean[key] = event[key]
            # Hash references instead of trusting arbitrary strings to contain no speech/PII.
            for key in ('recognitionAuthority', 'ruleId', 'decisionId'):
                if isinstance(event.get(key), str):
                    clean[key + 'Hash'] = digest(event[key].encode())
            events.append(clean)
        result['attempts'].append({'attemptAlias': 'attempt-' + str(i + 1), **identity_hashes(attempt), 'events': events,
            'srsWriteCount': max((e['persistenceWriteCount'] for e in events if 'persistenceWriteCount' in e), default=None),
            'studyLog': 'NOT_OBSERVED'})
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'verify-apk', 'sanitize'])
    parser.add_argument('input', nargs='?')
    args = parser.parse_args()
    try:
        if args.command == 'preflight':
            result = preflight()
        elif args.command == 'verify-apk':
            result = verify_apk(args.input)
        else:
            result = sanitize(json.loads(Path(args.input).read_text()))
        print(json.dumps(result, indent=2, allow_nan=False))
    except Exception:
        # Never echo malformed raw trace, local path, subprocess output, or device identity.
        print(json.dumps({'status': 'TOOLING_ERROR', 'reason': 'INPUT_OR_VERIFICATION_FAILED'}))
        raise SystemExit(1)

if __name__ == '__main__':
    main()
