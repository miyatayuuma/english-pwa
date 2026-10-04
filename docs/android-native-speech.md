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
release APK assets. No audio is saved.

Both Web Speech and Android request twenty alternatives. Provider returns may be
smaller; candidates are retained in provider order without synthesis, dedupe,
confidence sorting or contextual bias. Android does not send EXTRA_BIASING_STRINGS.
Recognition uses the system default provider, en-US/free-form/partial requests.
Each session uses a distinct recognizer/listener, created on the main thread.
Stop retains the session until final/error; terminal and cancel paths destroy it.
Old callbacks are ignored by session-object identity.

## Gate status

The `Android shell build` workflow builds debug/release, runs Android lint,
uploads the debug APK, and uses an API 35 Google APIs emulator for UI/data/
bridge/no-SW/system-permission instrumentation. Emulator recognition accuracy
does not measure physical-device recognition accuracy.

Gate A **PASS** on commit `97f32602a57ba63fc234a0e65bba9e6fc840a5be`: UI,
560-item loading, bridge calls, native SW disabled, system permission dialog,
debug/release builds and Android lint. Evidence: [Actions run 37118160209](https://github.com/miyatayuuma/english-pwa/actions/runs/37118160209).
Production migration started only after that gate passed.

## Production routing

Android shell uses AndroidSpeechRecognizerBackend; browsers and installed PWAs
keep Web Speech as the baseline. Reordering/compose/generate remain speech-disabled.
Both adapters feed the same `recognitionSegments` schema: segmentIndex,
primaryTranscript, alternatives [{transcript, asrRank, confidence nullable}], isFinal,
and requestedMaxResults/providerReturnedCount/retainedCandidateCount metadata.
Shared JS grading preserves primary TARGET/PARAPHRASE behavior and rescues only
strict TARGET productions from retained lower candidates (`nbest-target`). Existing
filler/restart handling and multi-segment safety remain unchanged. No cross-segment
alternative utterance is synthesized. Android never grades candidates.

Contextual bias plumbing and ON/OFF experiments have been retired. Shared Chunk
Authority remains the Reordering authority; it is not sent to recognizers.
Native partials only update preview; stop waits for final/error. Stale sessions,
double starts, cancellation and technical-error protections remain in place.

## Real-device cases after migration

Current source authority checked at the start:

| Case | Entry/source |
|---|---|
| yield to something | `vocab:00437`, E0343 |
| see to something | `vocab:00353`, E0285 |
| be in | `vocab:01282`, E0065 |
| yelled | word canonical `yell`, `vocab:01306`; actual source E0102: `"Turn the faucet off!" Mom yelled in a rage.` |

Use current `answerVariants(entry, activeOccurrence)` as strict Vocabulary authority.
The debug harness exposes actual TARGET surfaces, intended utterance, negative
control labels, all retained alternatives with provider ranks/confidence, requested
and actual counts, rescue/final grade and technical errors. Test positive cases and
near-target negatives (e.g. say "yeah" for TARGET "yell") and export JSON.
No physical-device counts or accuracy are inferred from CI. Provider returning
five or fewer candidates despite a twenty-result request is a provider limitation.
Device bias accuracy is not a production merge gate: production uses no bias.
