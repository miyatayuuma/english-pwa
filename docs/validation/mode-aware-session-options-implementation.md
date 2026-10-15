# Mode-aware session options implementation

Status: **MODE-AWARE SESSION OPTIONS UI BLOCKED**. Implementation and independent review complete; required Application CI is blocked by the explicitly protected E2E's fixed old-version assertion. PR #347 remains OPEN/unmerged. No production closure is claimed.

## Authority

- Initial and current main: `c0c1ea0be171c13734a95c862f35838d7269dfa5`, production v5.111.
- Branch: `feat/mode-aware-session-options`, created directly from that main.
- Implementation PR: https://github.com/miyatayuuma/english-pwa/pull/347
- Proposed release: v5.112; version, worker import/cache/precache, HTML bootstrap and update-prompt import synchronized.
- Adopted PR #346 Option A, without merging its branch:
  - https://github.com/miyatayuuma/english-pwa/blob/734e349e28cbe9a5be6dea4aff8a912f6586e5a8/docs/validation/session-options-mode-aware-design-audit.md
  - https://github.com/miyatayuuma/english-pwa/blob/734e349e28cbe9a5be6dea4aff8a912f6586e5a8/docs/plans/session-options-mode-aware-implementation.md
- Frozen #344 remains OPEN/NOT_VERIFIED at `6bae15beeb056d7575ba8dfd1b5b14a9bf80734e`. #346 remains OPEN at `734e349e28cbe9a5be6dea4aff8a912f6586e5a8`.

## Implemented behavior

- Chooser hands off pending method and character to details. Three accessible in-sheet methods show only applicable controls. Cancel/Close/Escape returns to chooser and discards detail changes.
- Game-method draft remains separate from selection/training mode. Read/Compose commits only after explicit Start; Vocabulary never writes sentence studyMode.
- Sentence count is auto/5/8/12/20/30/50. The existing planner supplies requested, eligible, actual and shortage counts. Start uses actual size. Auto retains the existing adaptive policy, including legitimate smaller plans when candidates/selection policy require them.
- Manual selection retains valid first-seen ID order, deduplicates, respects current filters/count cap and never backfills. Zero actual candidates disables Start and offers recovery.
- Legacy custom exact matches map to fixed choices. Invalid/nonmatching values restore auto with a notice; malformed legacy handoffs require another explicit Start. No rounding or durable schema.
- Vocabulary uses a private kind draft and existing buildVocabularySession authority, size request 12 and existing fresh-card cap. Preview reads the next rotation seed without consuming it or recent history. Direct Start revalidates and opens independent study without a second lobby.
- Read/Compose reload handoff is tab-scoped schema 1, explicit Start intent, APP_VERSION, method/options/character, nonce and timestamp, with a 120s lifetime. Remove-before-dispatch and consumed-nonce receipts prevent replay. Invalid/stale/replayed intent also suppresses legacy pending-course dispatch.
- Reload launch waits for complete relationship initialization. Generation plus method/options/Vocabulary-kind snapshots prevent old asynchronous Start after Cancel/reopen/edit.
- Saved-audio permission is requested synchronously inside the explicit Start gesture before branching/await/reload, then its result is awaited. Existing denied-permission fallback is retained.
- Preview and Start share the appropriate recent-ID authority: full prior plan on the same boot, persisted 12 IDs when a method reload will occur. The 20-previous/non-due/50-request cases match at 40 without reload and 48 with reload in both directions.
- Mobile fields align to the top instead of stretching Vocabulary rows; body scrolls while footer/Start remain reachable with safe-area padding. Hidden sentence controls cannot take focus.

## Independent review

A separate read-only reviewer found and re-reviewed fixes for relationship-initialization and stale-Start races, reload recency mismatch, and saved-permission ordering. Independently executed focused units: **42/42 PASS, 0 SKIP/TODO**. No unresolved major finding in reviewed code.

GitHub automated review P2 (saved permission bypass in Vocabulary/reload) was repaired in `714e799011727e23bf94e925faae658152f574c5`, verified, replied to and resolved:
https://github.com/miyatayuuma/english-pwa/pull/347#discussion_r4279499100

## Verified runtime evidence

Final tested runtime commit `59f418f4585058786833703bc68f784937bf0d87`:

- Application run https://github.com/miyatayuuma/english-pwa/actions/runs/38698000146 : **689 total / 679 PASS / 8 FAIL / 2 pre-existing ASR-09C/09D SKIP / 0 TODO**. All eight failures occur at the unchanged v5.111 assertion before those legacy scenarios run.
- New mode-aware production-UI Chromium suite: **26/26 PASS**, no skip. Covers all 360/390/430 viewports; all mode navigation/switch/cancel; fixed counts; real queues; 49/50 shortage; manual order/cap/reset; both reload directions; exactly-once/replay/stale/malformed rejection; Vocabulary isolation; zero recovery; legacy restoration; storage invariance; non-due recency across reload; Issue #342 interim-only no-grade; permission gesture/Cancel ordering.
- Existing saved-prompt audio restoration and options-submit permission tests: PASS after ordering repair.
- Android run https://github.com/miyatayuuma/english-pwa/actions/runs/38698000108 : Debug/Release/Lint and Gate A PASS. Gate A has five tests.
- Vocabulary validation and paraphrase scope guard: PASS at the same runtime commit.
- Mobile screenshot/JSON artifact: https://github.com/miyatayuuma/english-pwa/actions/runs/38698000146/artifacts/11955073511
- Evidence contains actual checkout SHA, APP_VERSION, viewport, controls, preview/actual/launch counts, storage snapshots and page/console errors. Screenshots were downloaded and visually inspected; no source imagery was generated.

The summary preserves the existing `対象 N文` text alongside the new detailed count breakdown, and the real zero-candidate browser scenario asserts that compatibility. All nine final-head mobile screenshots and 32 JSON evidence records were downloaded and checked: PASS records, v5.112 and zero recorded page/console errors. Actual CI checkout SHA is `644a0a506d2d5dc615277d09534a29a43f82837b` (the synthetic PR merge); its runtime tree matches the PR source. No protected test file was changed to obtain acceptance.

## Local validation and synchronized assets

- npm ci: PASS.
- Full local npm test: **689 total / 562 PASS / 0 FAIL / 127 SKIP / 0 TODO**. Local Chromium installation failed (downloaded archive was not a valid ZIP). Local skips are not browser acceptance; real browser evidence above is separate.
- Vocabulary derived/validation, TD-cluster-before-to, ASR-09B/09C/09D: PASS.
- Native sync: PASS, 119 runtime assets. Source/staging/Android byte comparison PASS. Generated native assets remain ignored under existing policy.
- diff check PASS. No SRS/scoring/ASR/finality/N-best/material/relationship-progression or localStorage schema changes.

## Protected identities and isolation

| File | Unchanged blob |
| --- | --- |
| data/vocabulary-v3.json | 91324d35b2db1911ece2cf3ff746409d321fe963 |
| data/items.json | ae2aca768b784199b77ac1cf8c0c5a80fd5725bb |
| data/characters.json | 1d0c61711d763373e1f587ecde16ff9f07cb1a45 |

`tests/helpers/browserVisibility.mjs`, `tests/helpers/mockSpeechRecognition.mjs`, `tests/issue210RealSession.browser.test.mjs`, #344's report/CI/branch and all protected learning/scoring authorities are unchanged. Only a separate evidence-upload step was added to existing CI; commands, concurrency, assertions and hard gates were not weakened. The existing Home navigation test adopts the required Close→chooser contract and still asserts no Start/storage write.

## Remaining hard gate and closure

The task explicitly prohibits edits to `tests/issue210RealSession.browser.test.mjs`, whose line 173 asserts **v5.111**, while this production change must be **v5.112**. The eight legacy real-session tests therefore stop before their behavioral assertions. The assertion is not skipped, spoofed or weakened. A separately authorized one-line version reconciliation is needed before those scenarios can run and required Application CI can pass; do not infer their acceptance from the new suite.

- PR #347: OPEN, merge held; merge SHA none.
- main/production remain c0c1ea0 / v5.111. No new Pages deployment or production SW/runtime acceptance is claimed.
- Issue #210 remains OPEN.
- PR #344 hidden-page E2E remains frozen NOT_VERIFIED.
- PR #323 Pixel physical-device acceptance remains DEVICE_PENDING.
