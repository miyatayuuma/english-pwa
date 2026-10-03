# Android Native Speech

Start main: `2805f92faffe351df6e1a97771da0d9f1738f8b1` (PR #263 included).

This branch introduces Capacitor **8.5.2**, Java NativeSpeech, and the existing
static Web UI. Android SDK compile/target **36**, minimum **24**, JDK **21**.
Dependencies are locked by `package-lock.json`. No bundler or UI rewrite.

## Reproduce

```sh
npm ci
npm run native:sync
./android/gradlew -p android assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity
```

`native:stage` follows literal ESM imports and stylesheet/HTML dependencies,
adds an explicit runtime-data/portrait allowlist, and copies the locked official
Capacitor ESM bridge. It excludes Service Worker, repository metadata, generators,
audit reports, tests and node_modules. Native and Web share application code.
The centralized `isNativePlatform()` check guards both existing SW callers.

## Bridge proof (debug APK only)

```sh
adb shell am force-stop com.miyatayuuma.englishpwa
adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity --ez nativeSpeechGate true
adb logcat -s NativeSpeech
```

The debug page calls `isAvailable`, requests microphone permission only on click,
and exposes start/stop/cancel plus transient callback output. It is absent from
release APK assets. `biasSupported` means API >=33 accepts the intent extra;
it does **not** prove the selected recognizer honors it. No audio is saved.

Recognition uses the system default provider, en-US/free-form/partial request/
maximum five alternatives. Exact strings are preserved; only empty rejection
and exact dedupe occur. API <33 omits bias. There is no boost, silence tuning,
offline preference, custom provider, on-device switch, alias or speech chunker.
Each session uses a distinct recognizer/listener, created on the main thread.
Stop retains the session until final/error; terminal and cancel paths destroy it.
Old callbacks are ignored by session-object identity.

## Gate status

The `Android shell build` workflow builds debug/release, runs Android lint,
uploads the debug APK, and uses an API 35 Google APIs emulator for UI/data/
bridge/no-SW/system-permission instrumentation. Emulator recognition accuracy
is not a substitute for real-device OFF/ON measurements.

Gate A **PASS** on commit `97f32602a57ba63fc234a0e65bba9e6fc840a5be`: UI,
560-item loading, bridge calls, native SW disabled, system permission dialog,
debug/release builds and Android lint. Evidence: [Actions run 37118160209](https://github.com/miyatayuuma/english-pwa/actions/runs/37118160209).
Production migration started only after that gate passed.

## Production routing

Android shell uses AndroidSpeechRecognizerBackend; browsers and installed PWAs
keep Web Speech. Reordering/compose/generate have no speech context. One read-only
shared metadata loader serves Reordering and speech. Stable itemId and optional
sentenceIndex select partitions; item-wide sessions collect every sentence in
source order, including fixed-context partitions. learningText goes unchanged
to the recognizer, with exact dedupe only. Vocabulary uses answerVariants strict
TARGET surfaces, excluding PARAPHRASE. No added whole sentence or overlap.

The speech-only recognitionChunks.js and weighted Web phrase planner have been
removed. Native results enter the existing primary/N-best schema with rank zero
primary and optional confidence; grading, strict lower-ranked TARGET rescue and
SRS authority are unchanged. Native partials only update the preview. Stop waits
for final/error, cancel invalidates the current controller, and both native/JS
reject stale sessions and double starts. Web fallback keeps its current capture
and grading behavior. Candidate PWA version: v5.79 (main remains v5.78).

## Real-device cases after migration

Current source authority checked at the start:

| Case | Entry/source |
|---|---|
| yield to something | `vocab:00437`, E0343 |
| see to something | `vocab:00353`, E0285 |
| be in | `vocab:01282`, E0065 |
| yelled | word canonical `yell`, `vocab:01306`; actual source E0102: `"Turn the faucet off!" Mom yelled in a rage.` |

Use current `answerVariants(entry, activeOccurrence)` as strict Vocabulary
authority. Do not assume `yelled` is the card canonical; validate its accepted
source surface. For sentence speech use only the E0102 shared partition strings.

On one device/provider record 10–20 trials per case per bias condition: rank-1
strict TARGET, strict TARGET anywhere in five candidates, grading accepted,
MISS, technical error. Alternate OFF/ON trial order to reduce learning/order bias.
Record provider/device/API explicitly. No real-device measurements exist yet. The debug validation page offers the
actual fixtures, OFF/ON selection, negative-control labels, intended utterance,
ranked results, optional confidence and existing grading. Its summary counts
rank-1 TARGET, N-best TARGET, accepted, MISS and technical error independently.
OFF is gated by Capacitor.DEBUG; release uses authority. Use `adb logcat -s
NativeSpeech Capacitor/Console` or inspect the debug WebView to retain the
transient JSON rows. No audio is recorded or stored. Clear records when switching
devices/providers. Confirm API >=33 and record the configured system provider
from capability output; intent-extra support is not proof of provider behavior.

| Case | OFF attempts / rank-1 / N-best | ON attempts / rank-1 / N-best | accepted |
|---|---|---|---|
| yield to something | unmeasured | unmeasured | unmeasured |
| see to something | unmeasured | unmeasured | unmeasured |
| be in | unmeasured | unmeasured | unmeasured |
| yelled / E0102 | unmeasured | unmeasured | unmeasured |

**Release/device closure pending:** 10–20 OFF/ON trials per case and all negative
controls on one real device/provider. No recognition-quality percentage or
false-positive conclusion can be claimed from emulator smoke tests.

Negative controls: omitted words, omitted chunk, wrong content word, wrong tense,
swapped chunks, interrupted utterance. Keep primary/N-best/grading results for
each. Systematic acceptance of clear wrong answers blocks release. Do not change
grading or add fuzzy/phonetic rescue to hide recognition defects.
