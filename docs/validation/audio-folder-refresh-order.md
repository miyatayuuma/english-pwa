# Audio-folder refresh: main CI recovery

Base: main `f61180b9a7382fde202081c5d2c7a82383d0f110` (Vocabulary count PR #351, v5.114). Follow-up for #350 / #210. Runtime candidate: v5.115.

## Reproduced causes

Main Application run 39014355540 failed the existing explicit folder-selection browser test on both attempts. A local Chromium 151 trace reproduced the same timeout: the fixture wrote only four ID3-like bytes, its mocked `readyState`/`load` reported readiness, and the real sentence autoplay called `play()`. Chromium rejected the invalid payload with `NotSupportedError`; the production fallback correctly cleared the failed source. This was not evidence that the Vocabulary count queue or SRS failed.

A separate controlled OPFS latency test exposed a real ordering defect: an initial missing-file lookup could return after a selected-folder lookup, clear the newer source and cache the stale empty result. Holding only the real filesystem's initial missing lookup reproduced the failure with a valid WAV and ordinary Chromium media decoding, before the resolver repair. The same regression passes after repair.

## Repair

- Generate a valid one-second silent PCM/WAV in OPFS under the existing lesson filename. Remove fake media readiness/load overrides; Chromium performs actual decoding/playback. Preserve existing handle, permission, picker, reload and clear assertions, and assert real decoder readiness without a media error.
- Resolver lookups share a pending result per filename and generation. `clear()` invalidates cache and pending work. Older callers join the current generation instead of returning/cache-writing stale data.
- Invalidate the resolver after the newly saved directory becomes the in-memory authority, without an intervening await. Explicit clear and saved permission restoration retain their existing behavior.
- Regression tests cover delayed initial absence, multiple invalidations and concurrent callers. ASR finality, recognition, scoring, SRS, study-log and relationship algorithms are unchanged.
- v5.115 synchronizes the version module, SW/cache query strings, bootstrap, HTML, version-only existing real-session assertion and generated Native assets. No new storage key or persistent schema.

## Verification

Local npm ci, full required-browser npm test, Vocabulary validators, TD-cluster / ASR-09B/C/D validators, native sync and diff checks are required. Exact-head CI/review and post-merge results are recorded in the follow-up PR and Issue #350. ASR-09C/09D's two existing contextual Chromium skips remain unverified; they are not counted as passes. Pixel #323 stays DEVICE_PENDING and #344 stays CLOSED / UNMERGED / NOT_VERIFIED. The historical #346 audit and v5.113 Pixel acceptance kit are unchanged.

Protected blobs remain Vocabulary `91324d35b2db1911ece2cf3ff746409d321fe963`, Items `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`, Characters `1d0c61711d763373e1f587ecde16ff9f07cb1a45`.
