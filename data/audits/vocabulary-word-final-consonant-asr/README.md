# Vocabulary word-final consonant ASR collision audit

This is an audit-only authority package for Vocabulary v3 at `49184d2f3324f1a6af05f6e2d13e17c94bc5ddee`.

## Scope and target authority

The audit scanned all 2,478 entries and all current Vocabulary grader TARGET surfaces: canonical forms, `answers[]`, and source occurrence substrings obtained from the current occurrence offsets. It did not include `paraphrases[]`. The surface inventory contains 4,970 rows (2,478 canonical, 11 answer surfaces, and 2,481 occurrence surfaces); repeated text remains attached to each entry and occurrence.

## Discovery

Every target token was looked up in the American English CMU Pronouncing Dictionary. For every pronunciation ending in a consonant, the audit recorded the coda and following token/phone. Candidate discovery removed exactly one final consonant phone and exact-matched the resulting phone sequence against pronunciations of words in the 20,000-word frequency list. All coda consonant classes were searched; vowel phones and all retained segments had to match exactly. Same-spelling alternatives were excluded as non-collisions. The sole dictionary coverage supplement was plural `hemispheres`, derived as `hemisphere + /z/` for two token instances.

The 20,000-word list is only candidate discovery. The major-word screen uses its top 10,000 entries and excludes known names, letter names, interjections, abbreviations, and nonstandard forms. Candidate records preserve lexical rank and the screening reason.

This process intentionally over-generates exact lexicon hits. Final decisions are context sensitive: /t,d/ in consonant-boundary and coda-cluster contexts, stop-release masking, adjacent identical/near-identical boundary compression, function-word context, vowel identity, and lexical/grammar risk are reviewed separately. A dictionary hit does not itself establish a plausible ASR output. ASR plausibility here is qualitative; no ASR provider confusion corpus was available or measured.

Research supports the conservative emphasis on context: spontaneous American English stops are often unreleased, while deletion evidence in the cited sample was concentrated in coronal /t,d/; corpus work also finds /t,d/ cluster deletion varies by following environment and differs from vowel-context flapping. See Davidson, JASA (2010), DOI 10.1121/1.3508799; Park, *Modern English Education* (2020), DOI 10.18095/meeso.2020.21.1.56; and Baranowski & Turton, *Language Variation and Change* (2020), DOI 10.1017/S0954394520000034.

## Decision policy

- `SAFE`: only the user-specified apt/app seed is approved, and only for the two exact TARGET surfaces in `vocab:01166`.
- `REVIEW`: the target-sense exact vowel-preserving deletion path is plausible in its recorded consonant context, but lexical/grammar risk or unmeasured ASR behavior prevents approval.
- `REJECT`: the collision is not a major standard word, uses a dictionary homograph pronunciation that conflicts with the target phrase, depends on a weak or non-natural reduction environment, or is only a dictionary/spelling hit.

CMUdict homograph paths were checked against the contextual target sense. For example, `wind something up` is /waɪnd/ (not noun /wɪnd/), `lives from hand to mouth` is /lɪvz/, and `in tears` is /tɪrz/. Wrong-sense paths are retained as excluded traces in `candidates.json`; the vowel-preserving `wind → wine` paths are REVIEW.

`apt to → app to` is SAFE. `apt to → up to` is an explicit REJECT control because /æ/→/ʌ/ changes the vowel. `see → say` and `yield → yelled` remain out of scope. No general coda-deletion rule was added to production.

## Files

- `surface-inventory.json`: every scanned TARGET surface, with entry and occurrence identity.
- `coda-sites.json`: all 7,870 target-token coda sites and 10,079 pronunciation coda paths.
- `candidates.json`: full classified master inventory. Record key: surface reference + token index + deleted final phone + collision spelling.
- `safe.json` / `review.json`: complete records for those decisions.
- `rejected.json`: rejected candidate IDs; full records and reasons are in `candidates.json`.
- `registration-candidates.json`: SAFE-only entry/surface pairs for a separate future integration task.
- `controls.json`, `manifest.json`, `validation.json`: controls, provenance/counts, and checks.
- `validate-audit.mjs`: dependency-free Node validator; run from this directory with `node validate-audit.mjs`.

## Production boundary

This branch changes audit artifacts only. It does not add an equivalence, change the speech grader or normalizer, alter Vocabulary data, or modify chunk N-best/Android recognition behavior. The open Vocabulary chunk-rescue work remains separate.
