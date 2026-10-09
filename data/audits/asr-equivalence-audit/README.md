# ASR equivalence corpus candidate audit

This artifact scans the current Vocabulary and Read source populations without editing either production dataset.

- Vocabulary blob: `c23643d26e71be22aaec5ec04ce63a7582ad9c25`; items blob: `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb`
- Vocabulary: 2,478 entries; 7,227 audited canonical/answer/paraphrase/source-surface records
- Read: 560 sentences (all included in joined/split and spelling candidate scans)
- Same-entry surface pairs: 2; cross-corpus joined/split pairs: 17 (1 explicitly registered, 16 review-only)
- Mechanically safe or already explicit: 2
- Same-entry review-only pairs: 0; cross-corpus joined/split and spelling pairs held for review: 16
- Cross-corpus hyphen/space candidates: 0; apostrophe glyph/presence pairs: 0 safe / 0 review-only; numeric/unit normalized pairs: 0
- Final t/d plus to surfaces: 10
- Cross-locale spelling pairs observed in both forms: 0
- Registered speech rules inventoried: 89

Joined/split pairs, locale spelling pairs, and new phonetic candidates remain review-only unless an exact explicit rule exists. Production data and card semantic authority are not modified by this audit.

Full per-entry, per-sentence coverage and candidate details are in [audit.json](./audit.json).
