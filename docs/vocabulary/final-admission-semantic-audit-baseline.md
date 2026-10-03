# Final Admission semantic audit baseline

The materialization begins at main `e96a9435a9648b76f72b21d76666e34548374a5c`.
Production is frozen at **2,478 entries: 1,422 words, 997 expressions, 59 constructions**.

`data/vocabulary-v3-final-admission-materialization.json` fixes IDs, kinds, origin,
Final ADD joins, the two merges, all 25 reclassifications and population identity.
`data/vocabulary-v3-semantic-audit-inventory.json` lists every production entry and
explicit ID partitions for each kind. Workers must use the same merged main SHA
and production blob identity, and refer to stable IDs rather than array positions.

Every surviving existing ID is preserved. New IDs append in the unchanged Final
ADD array order: `vocab:01074` through `vocab:02481`. Historical gaps and merged
IDs (`vocab:00147`, `vocab:00626`) are not reused. Progress transfers only when the
merge target lacks state; the original state remains available.

## Audit boundaries

Audit **both existing and newly materialized entries**. Do not ADD, DROP, MERGE,
split, change kinds or change IDs. Report authority corruption before acting.
Meaning, canonical, sense keys, POS, answer variants and context wording remain
subject to semantic audit. Provisional `pending_admission_*` keys distinguish
fixed ADD records; they are not a claim that the intended sense has been audited.

Initial new meanings reuse 999 v2 glosses, 75 v1 glosses and four resolved sense
interpretations. Another 330 entries explicitly show a source-reference meaning
placeholder and retain source Japanese for occurrence context. The manifest
records initialization evidence for each new ID. No new paraphrases were curated.
The paraphrase artifact preserves the original 1,072-entry review and explicitly
marks 1,408 new cards plus 25 reclassified cards pending; it does not claim they
have been reviewed. The word audit keeps the original PR #235 cohort separate.

## Source and derived authority

For all 1,408 new entries, item IDs and UTF-16 spans come exclusively from
`data/vocabulary-v3-final-admission-occurrences.json`. Recovery statuses remain in
that artifact and never influence runtime grading. Semantic workers must retain
this linkage; a different source needs explicit authority reconciliation.

After authorized semantic edits, run `npm run vocab:sync-derived`, then
`npm run vocab:check-derived` and `npm run vocab:validate`. The inventory and report
are generated. The freeze validator permits semantic edits while preserving the
population, kinds, stable IDs and new source occurrences. The materializer is a
one-time initializer; do not rerun it over audited production data.
