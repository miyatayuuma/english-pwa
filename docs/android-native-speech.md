# Android Native Speech — Gate A

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

**Production speech routing, weighted Web bias removal, and legacy chunker
removal must wait for Gate A PASS.** This is not a closed native migration.

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
Record provider/device/API explicitly. No measurements exist yet.

Negative controls: omitted words, omitted chunk, wrong content word, wrong tense,
swapped chunks, interrupted utterance. Keep primary/N-best/grading results for
each. Systematic acceptance of clear wrong answers blocks release. Do not change
grading or add fuzzy/phonetic rescue to hide recognition defects.
