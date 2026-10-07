# ④-C REJECT family prioritization

Status: CLOSED (audit-only). This report prioritizes the remaining historical REJECT population. It does not reopen or change any SAFE/REJECT decision.

## Authority and population

- Original closed audit HEAD: 7ba04b6e11b18950f4dbcf9526350be524a599eb
- ④-A2 provenance base / branch HEAD: 76085365bd3f5759bf3048df427574f350d01191
- Current main recorded for later drift check: f448394e3052c686d8cad97912c3b779345b758e
- Historical original REJECT: 4,658
- A2 promoted REJECT→SAFE: 17 (excluded)
- A2 already-reconsidered REJECT retained: 16 (excluded)
- Remaining discovery population: 4,625; verified partition: 4,658 − 17 − 16 = 4,625
- Original SAFE records (8), all A2 promoted records, and all 16 A2 reviewed rejects are excluded from the remaining discovery IDs.

The full 4,625-ID partition is in population.json. Source records come from the full original candidates.json, not rejected.json’s ID index. All 4,625 remaining records receive exactly one primary mechanical family; secondary tags may overlap. A2-reviewed IDs are absent from family ranking. Other historical deletions before the token to remain in the full population only when they were outside A2’s /t,d/ cluster authority; the /t,d/ C+final-before-to cluster in the remaining population is 0. Current-main surface drift is intentionally not checked in this prioritization phase.

## Mechanical clustering and extraction

Each member record preserves the candidate and entry IDs, surface reference/type, target and collision strings/pronunciations, deleted and preceding phones, coda structure, immediate following token/phone/class, phrase-final status, stress, morphology heuristic, lexical rank, same-entry overlap fields, original REJECT rationale/confidence, and exclusive primary family. Original rationale text is retained in each row and also deduplicated in rationale-catalog.json.

Primary clusters use deleted phone × coda structure × following-phone class. The narrow unstressed and→an pattern receives its own exclusive family. Phone classes are stop, fricative, affricate, nasal, liquid, glide, vowel, phrase-final, or other. Coda classes are singleton final, C+final, CC+final, and other. The report separately counts C+T and C+D by following phone class; it does not make one large “/t,d/ before consonants” family.

Boundary-token counts in family-summary.json are occurrence counts within these audit candidates, not external corpus ranks. In the full remaining population, frequent following tokens include of (155 records/47 entries), something (122/84), to (119/44), the (117/43), and a (100/38). The remaining to records are outside the already-closed A2 /t,d/ C+final family; that specific cluster has 0 remaining records. The token and is also frequent (35 records/7 entries) but those records do not all map to and→an. No function-word anchor was chosen before inspecting the actual token distribution.

Morphology labels are string-pattern heuristics and are not POS annotations. Grammar plausibility labels are screening hints only. Same-entry overlap distinguishes the closed audit’s stored overlap flag from repeated records in this remaining population.

## Family-level evidence and interpretation

The strongest candidate is the exact unstressed conjunction and /AH0 N D/ → an /AH0 N/ before an immediately following consonant, excluding to: 24 records, 16 entries, 20 unique target-surface→ASR-surface pairs. Cambridge Dictionary lists weak forms of and including /ənd/ and /ən/, which provides family-level pronunciation evidence. It does not establish that every listed surface will be reduced in production or that any ASR provider will output an. The remaining original reasons repeat lack of individual weak-form evidence, residual stop cues, lexical/grammatical identity change, and unmeasured provider confusion.

The other high-ranking subgroups remain separate:
- C+D before fricatives: 48 records / 21 entries after the dedicated and→an records are split out.
- C+D before nasals: 12 records / 6 entries.
- C+T before fricatives: 23 records / 9 entries.
- C+T before stops: 16 records / 8 entries.

Park (2020) reports context-sensitive cross-word C/t,d/#C deletion and higher rates before sonorants than obstruents. Davidson (2010) distinguishes complete deletion from the more common non-release and notes residual acoustic cues. Morphological context also affects t,d deletion rates (Tagliamonte et al., 2020). These studies justify splitting environments for family characterization; none grants SAFE authority to any candidate.

## Ranking method

family-ranking.json states the formula and each family’s 1–5 input ratings:
Score = round(20 × [0.25E + 0.20P + 0.15B + 0.15V + 0.15F + 0.10R]).

E = family phonetic evidence; P = productive naturalness; B = runtime boundability; V = practical value discounted for lexical-screen failures; F = strength of false-positive controls; R = how specifically the old reason can be addressed by a family review. Scores rank research value only. They are not probabilities and do not change candidate decisions.

## Next addendum recommendation

Recommend one next family review: **unstressed and /AH0 N D/ → an /AH0 N/ before an immediate consonant, excluding to**. Exact filter, exclusions, examples, and controls are in next-addendum-recommendation.json.

The next dedicated addendum should rescan accepted paraphrases and current accepted production surfaces after family selection. Add exact entry/surface anchors and grammar negative controls. Preserve controls for Ann/Anne, strong /AE1 N D/, phrase-final forms, vowel-following forms, and the already-closed A2 to family. No accepted-paraphrase rescan or current-main drift check is run here.

## Audit-only boundary

No production Vocabulary, speech code, production tests, versions, PR #308, or current-main files are changed. This branch contains only this audit directory. No production PR or merge is created.
