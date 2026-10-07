# /t,d/ Cluster Before `to` — ASR Collision Audit Addendum

## Recovery result

This addendum was regenerated from the immutable base `7ba04b6e11b18950f4dbcf9526350be524a599eb`. The remote branch was verified at the same SHA before work. The recovery matched the prior checksum without adjusting any candidate or decision to fit it.

| Measure | Regenerated |
|---|---:|
| Eligible target sites | 102 |
| Existing audit candidate matches | 41 |
| New accepted-paraphrase candidates | 14 |
| Adjudicated candidates | 55 |
| SAFE | 36 |
| REVIEW | 0 |
| REJECT | 19 |
| Existing SAFE retained | 8 |
| Existing REJECT → SAFE | 17 |

Eligible target sites count the target word position: one source TARGET contains two eligible positions, so 102 sites correspond to 101 distinct surface references.

## Fixed authority

The eligible environment is a word-final consonant cluster whose final segment is /t/ or /d/, immediately followed by the token `to` with initial /t/. A SAFE path deletes only that final segment. Vowels, onset, all remaining phones, token count, and token order must stay identical. Morphological spelling differences alone do not reject a qualifying phonetic path.

The paraphrase pass reads only already accepted `paraphrases[]` from the immutable Vocabulary. It does not reassess meaning. CMUdict and the 20k frequency list are pinned to the exact blob SHAs in `manifest.json`. Candidate extraction matches different-spelling dictionary words; the existing top-10,000/manual lexical screen remains in force at adjudication.

## Historical audit

The closed audit at `7ba04b6e11b18950f4dbcf9526350be524a599eb` is unchanged. Its 4,666 records remain historical authority (8 SAFE, 0 REVIEW, 4,658 REJECT). The 41 matching records are copied into this addendum with their original decision and reason. Seventeen old REJECT records move to SAFE under this addendum's family authority. Eight old SAFE records remain SAFE. The other 16 remain REJECT because the collision candidate fails the prior major-word screen.

The 14 new paraphrase candidates comprise 11 SAFE and 3 REJECT. No candidate remains in REVIEW.

## Mandatory and negative controls

- `tend to do something → ten to do something`: SAFE
- `tend to associate politicians with hypocrisy → ten to associate politicians with hypocrisy`: SAFE
- `apt to → up to`, `see → say`, and `yield → yelled`: not SAFE

## Scope

This directory contains audit authority only. Production Vocabulary, speech equivalence, grader, normalizer, N-best rescue, Android code, PR #306 implementation, and PR #307 artifacts were not changed. The addendum remains based on `7ba04b6e11b18950f4dbcf9526350be524a599eb`; it is not rebased to current main.

Before production implementation, phase ④-B must drift-check these SAFE surfaces against accepted surfaces on current main `22d4f37b48177b9a42a4b215330f0d7231400779`.
