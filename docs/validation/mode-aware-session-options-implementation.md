# Mode-aware session options implementation

Status: implementation complete; browser/Android acceptance pending. Do not merge.

## Authority

- Initial main: `c0c1ea0be171c13734a95c862f35838d7269dfa5` / v5.111.
- Implementation branch: `feat/mode-aware-session-options`, created from initial main.
- Release: v5.112; version/SW/bootstrap URLs updated together.
- Design authority (open documentation PR #346):
  - https://github.com/miyatayuuma/english-pwa/blob/734e349e28cbe9a5be6dea4aff8a912f6586e5a8/docs/validation/session-options-mode-aware-design-audit.md
  - https://github.com/miyatayuuma/english-pwa/blob/734e349e28cbe9a5be6dea4aff8a912f6586e5a8/docs/plans/session-options-mode-aware-implementation.md
- #344 remains frozen/NOT_VERIFIED; no branch, diagnostic, helper, E2E, report or CI changes imported.

## Implementation

- Chooser hands off its uncommitted game method and character. Cancel/Close/Escape returns to the chooser and drops detail drafts.
- Three in-sheet methods with pressed-state accessibility; sentence fields, Read-only shadowing, and independent Vocabulary card-kind fields.
- Sentence choices: auto/5/8/12/20/30/50. Preview calls the existing sentence planner and reports requested/eligible/actual/shortfall; Start uses actual count. Manual order/deduplication/scope/limit/no-backfill remain under the existing planner.
- Legacy custom exact matches map to fixed choices; other values restore auto with a notice, with no rounding or localStorage schema.
- Vocabulary owns a private kind draft and exposes a narrow preview/start bridge. Both use the existing `buildVocabularySession`, fixed size request 12 and current fresh-card cap. Preview peeks the next rotation seed and does not write recent IDs or rotation. Start revalidates and uses existing scoring/recognition flow, directly opening study.
- Read/Compose persists only after explicit Start. Cross-boot starts use a tab-scoped schema-1 intent, app version/method/character/options/nonce/time, 120s lifetime, remove-before-dispatch and consumed-nonce receipts. Invalid/replayed intent cannot dispatch the legacy pending course.
- Reload launch waits for relationship authority initialization before changing `ALL_ITEMS`; async Start validates draft generation and a method/options snapshot to prevent Cancel/reopen/edit races.
- No SRS/scoring/ASR/recognition-finality/material or durable schema changes.

## Independent review

Separate read-only review found two P1 races: relationship initialization preceding reload launch, and stale asynchronous Start after Cancel/reopen/edit. Both were repaired and re-reviewed. Reviewer independently ran 38 focused tests: 38 pass, no skip/TODO. No unresolved major findings in reviewed code. Browser evidence and Android acceptance are outside that review's verified scope.

## Initial local validation

- npm ci: PASS.
- Focused count/handoff/shell/menu/migration tests: PASS (expanded totals in final record).
- Full local npm test before final test additions: 678 total / 558 pass / 0 fail / 120 skip / 0 TODO. Chromium-dependent skips are not acceptance.
- Vocabulary derived/validation, TD-cluster-before-to, ASR-09B/09C/09D: PASS.
- Native sync: PASS, 119 runtime assets. Staged/Android byte comparison PASS; final sync repeated after code changes.
- Local Playwright Chromium installation failed: downloaded archive was not a valid ZIP (`End of central directory record signature not found`). No repeated installation attempts after the installer exhausted its own mirrors.
- New independent browser test file records source SHA/version/viewport/control visibility/plan/started count/storage/errors and mobile PNGs under `docs/validation/mode-aware-session-options-evidence/` when Chromium is available. It uses existing ISSUE210_REQUIRE_BROWSER hard-fail behavior in CI.

## Explicit validation conflict

The task explicitly prohibits edits to `tests/issue210RealSession.browser.test.mjs`. That main file contains a fixed v5.111 assertion at line 173, while this production change must bump to v5.112. The implementation preserves the protected file byte-for-byte and does not weaken, skip or spoof that assertion. Required real Chromium CI therefore cannot fully pass under both constraints. Record actual CI failures and keep the PR open/BLOCKED until the version assertion is separately reconciled or the user authorizes that narrow change.

## Protected identities

| File | Blob |
| --- | --- |
| data/vocabulary-v3.json | 91324d35b2db1911ece2cf3ff746409d321fe963 |
| data/items.json | ae2aca768b784199b77ac1cf8c0c5a80fd5725bb |
| data/characters.json | 1d0c61711d763373e1f587ecde16ff9f07cb1a45 |

Issue #210 stays OPEN. PR #344 hidden-page E2E and PR #323 Pixel physical-device acceptance remain separate and unverified by this implementation. DEVICE_PENDING. No merge or production deployment acceptance is claimed.
