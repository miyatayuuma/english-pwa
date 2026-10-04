# Vocabulary v3 Representative Meaning / Canonical Audit

Fixed semantic baseline: `85506d6ce258d2bd12f8ec80e937fbdd5e7a098d`.
Vocabulary blob: `ddc77e399048fc622605f4837f1487763e489624`.

13 load-balanced shards cover all 2,478 entries. Placeholder density, repeated lemmas and expression length contributed to shard weights. `manifest.json` preserves assignments, known placeholder IDs and baseline field/nonsemantic fingerprints. Every assigned entry has a KEEP or MODIFY decision, before/after values and an individual reason. No default KEEP pass was used.

`reconciliation.json` is the effective central authority: it records notation policy, all eight same-canonical sense groups, secondary review dispositions, overrides and the latest-main integration gate. Explicit Admission concepts (including their parenthetical senses) take precedence over provisional meanings. Within those boundaries, the card uses a representative dictionary meaning rather than a source-only translation.

`summary.json` contains aggregate evidence. `followups.json` records deferred POS, contextual translation and paraphrase issues without mutating those fields. Paraphrase and context audits remain separate tasks. A historical upstairs example in the word audit is synchronized only for its representative meaning; its source and contextual meaning remain unchanged.

Run:

```sh
npm run vocab:validate
node scripts/vocabulary/validate-meaning-canonical-audit.mjs --check-production --check-integration-scope
npm test
node scripts/reorder/validate-reorder-metadata.mjs
```

The integration-only scope flag verifies all nonsemantic fields against baseline fingerprints. Routine production checks verify representative authority and frozen IDs/kinds/order while allowing later authorized paraphrase/context work. Local unit execution passed 299 tests; 51 browser tests required Chromium in CI. PR workflow check results provide browser and CI execution evidence. The existing natural-answer validator supports the standardized `or` and `+ adjective`/`+ clause` canonical pattern notation without changing grading authority.
