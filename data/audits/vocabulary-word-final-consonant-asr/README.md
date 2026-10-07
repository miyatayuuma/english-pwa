# Vocabulary word-final consonant ASR collision audit

Audit-only authority for Vocabulary v3 at `49184d2f3324f1a6af05f6e2d13e17c94bc5ddee`.

## Scope and final counts

The closed population remains 2,478 entries, 4,970 TARGET surfaces, and 4,666 candidate records. Only the previous 209 REVIEW records were adjudicated; discovery and full-population scanning were not repeated.

| Classification | Before | After |
|---|---:|---:|
| SAFE | 2 | 8 |
| REVIEW | 209 | 0 |
| REJECT | 4,455 | 4,658 |
| Unclassified | 0 | 0 |

Six additions to SAFE:

- `wfc-02515`: `be used to something → be use to something`
- `wfc-02523`: `I'm used to it → I'm use to it`
- `wfc-03391`: `be supposed to do something → be suppose to do something`
- `wfc-03392`: `am I supposed to do → am I suppose to do`
- `wfc-04076`: `used to do something → use to do something`
- `wfc-04078`: `used to be → use to be`

The existing `apt → app` pair remains SAFE. Totals: 8 SAFE surface records, 4 entries, 3 unique word pairs. All are NEW_CANDIDATE with no same-entry TARGET overlap and no explicit-equivalence overlap.

## Adjudication threshold

SAFE needs positive evidence that a natural target pronunciation can lose the specific coda contrast and reach the candidate without changing a vowel or onset. An unreleased stop, plausible dictionary word, possible masking, or lack of ASR measurements alone is insufficient.

The six additions are restricted to the exact `used to` and `supposed to` surfaces above. An American English phonetics text lists weak `used to` /juːstə/ and `supposed to` /səpoʊstə/: the /d/ can be absent before weak `to`, leaving the recorded candidate sequence. The written morphology still differs, so approval is exact-surface only. This does not extend to other `-ed to` phrases or create a general deletion rule. ASR-provider confusion rates were not measured.

The other 203 former REVIEW records are REJECT for automatic rescue authority. Variable phonetic possibility does not prove practical loss in that exact context; closure/timing cues and lexical or grammatical risk remain.

## Evidence and limits

- Park, JinSook (2020), “English word-final coronal stop deletion in high frequency words,” *Modern English Education* 21(1), 56–64, DOI [10.18095/meeso.2020.21.1.56](https://doi.org/10.18095/meeso.2020.21.1.56). Buckeye Corpus analysis reports context-sensitive /t,d/ deletion in C/t,d/#C, affected by adjacent consonants and more frequent before sonorants.
- Davidson (2010), “Variation in stop releases in American English spontaneous speech,” *JASA* 128, 2458, DOI [10.1121/1.3508799](https://doi.org/10.1121/1.3508799). Unreleased stops are much more common than complete deletion in the reported sample; non-release is not treated as deletion.
- Broeders & Gussenhoven, *An Introduction to American English Phonetics* §7.6, [Contractions](https://opentextbooks.rug.nl/americanenglishphonetics2/chapter/7-6-contractions/), lists the two weak forms used to and supposed to.

Homograph authority remains contextual: `wind something up` uses verb /waɪnd/, not noun /wɪnd/. Vowel-preserving `wind → wine` records are now REJECT for insufficient phrase-level rescue evidence. Controls `apt to → up to`, `see → say`, and `yield → yelled` remain outside SAFE.

## Artifacts and production boundary

`candidates.json` contains the complete inventory and per-record final adjudication. `review-adjudication.json` preserves the original 209 IDs with context, confidence, phonetic path, overlap, and Q1–Q6 rationale. `safe.json`, `review.json`, `rejected.json`, and `registration-candidates.json` are synchronized.

Only audit-directory files change. No production Vocabulary, grader, normalizer, explicit equivalence, UI, N-best, or Android code changes.
