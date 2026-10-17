# Vocabulary selectable session counts

Implementation: PR #351, Issue #350, parent #210. Initial main: `88337f9e42c2d065d5024e26fe34bee0fde8c544`. Runtime candidate: v5.114. Final PR/merge identities and final CI outcomes are recorded in the PR.

## Contract

- Shared details and the independent Vocabulary lobby offer auto / 5 / 8 / 12 / 20 / 30 / 50. Auto targets 12. Count is an in-memory Vocabulary draft, independent of sentence options; opening a new setup defaults to auto. Kind remains all / word / expression.
- Both previews and Start call `vocabularyPlan`, passing current eligible entries, level state, kind, count, recent IDs and next rotation seed to the production planner. Preview writes no storage. Start revalidates a token covering those inputs and selected IDs, then commits rotation/recent once. Changes during an asynchronous audio-folder permission request require renewed confirmation with an updated preview.
- Public planner size is rounded and clamped to 1–50. Undefined/NaN/nonfinite and legacy zero retain the 12 target. UI accepts only the enum. Duplicate IDs are collapsed before selection; combined-deck duplicate-card policy remains intact.
- Due → Fresh → Learning → Stable order, existing recent penalty within buckets, and default fresh cap `min(8, target)` remain intact. 50 fresh candidates yield 8 cards, not 50. Metadata separates candidate scarcity from fresh-cap restriction and the sum reconciles exactly to target minus actual size.
- Existing `recentVocabularySessionIdsV1` now reads/writes up to 50 unique IDs; old arrays remain readable. No new persistent key or SRS migration is introduced. Starting a session records selection, not grading. Recognition, grading, SRS algorithms and relationship progression are unchanged.
- All versioned SW references move to v5.114; no new runtime module/precache entry is required. `npm run native:sync` stages and copies the dependency graph to Android.

## Verification boundaries

Unit matrix covers all targets, invalid/public API values, duplicate IDs, kind filters, due priority, fresh cap, rotation, 50 recent IDs, fallback and shortage metadata. Browser matrix covers both actual entry points, real preview/committed IDs, exactly-once history writes, no preview writes, 49/50 scarcity, fresh-only cap, zero eligibility, kind/count changes, cancel/reset and sentence-state separation. Completion cases exercise actual 5/50-card queues through the production recognizer/grader/SRS, negative interim/error controls and stale callbacks; correction has a separate 50-card session negative SRS-write check. Provider input and dataset subsets are controlled fixtures; microphones and Pixel are not exercised.

Mobile evidence: `vocabulary-count-evidence` CI artifact, both routes at 360×844, 390×844 and 430×844. Screenshots and numeric bounds accompany real queue tests; browser fixture skips are not acceptance. Existing ASR-09C/09D explicit contextual Chromium skips remain unverified. Final observed totals and hard-gate results are in PR #351.

Protected source blobs must remain:

| Data | Git blob |
|---|---|
| Vocabulary | `91324d35b2db1911ece2cf3ff746409d321fe963` |
| Items | `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb` |
| Characters | `1d0c61711d763373e1f587ecde16ff9f07cb1a45` |

## Physical-device follow-up

PR #323 remains DEVICE_PENDING. The v5.113 Pixel kit is historical and is not rewritten; obtain and verify a new current-main APK before testing v5.114. Supplement its UI-04/UI-06 with both Vocabulary entry points and all seven count choices. For each, record target, eligible candidates, actual cards, shortage and actual reason. A new-only pool must retain the eight-card cap. Verify 50-card completion only with sufficient previously learned/review cards reachable in ordinary use, without resetting or fabricating user SRS. Check count/kind taps, selection state, scroll, Start/cancel and normal home return on the real Pixel. These actions remain NOT_RUN here.

PR #344 remains CLOSED / UNMERGED / NOT_VERIFIED; no branch update, hidden-state simulation or acceptance claim is included. Issue #210 stays OPEN. PR #346's fixed-12 Vocabulary statement describes its historical design; this approved change supersedes that runtime contract without changing the old audit.
