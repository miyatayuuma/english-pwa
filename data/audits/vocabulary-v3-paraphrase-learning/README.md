# Vocabulary v3 Paraphrase Learning-Value Audit

This directory is the fixed coordination surface for the 2,478-entry paraphrase audit.

## Partition authority

`manifest.json` freezes only the stable entry-ID order and the 25 batch boundaries. It does **not** freeze meanings, canonicals, answers, source text, or existing paraphrases. Workers must read current semantic fields from the latest `main:data/vocabulary-v3.json`.

- batches 001-024: 100 entries each
- batch 025: 78 entries
- batch assignment is by manifest entry IDs, never by numeric vocab-ID ranges
- workers must not recompute or repartition the manifest

## Ownership

A batch is owned only after the worker successfully creates the manifest-declared remote claim branch from the latest main SHA.

Example:

`audit/paraphrase-learning-v1-batch-001`

Checking that a branch is absent is not a claim. Remote branch creation success is the claim.

If creation fails specifically because the ref already exists, refresh remote state and try the next uncompleted/unclaimed batch. Any other failure is an error and must not be treated as a competing claim.

Do not pre-create claim branches.

## Completion

A batch is complete only when its manifest-declared artifact path is present on `main`, e.g.

`data/audits/vocabulary-v3-paraphrase-learning/batch-001.json`

Claim branches and open PRs mean in progress, not complete.

Workers must not maintain a shared status JSON. Coordination authority is intentionally split into:

1. `manifest.json` — immutable partition
2. remote claim branch — ownership
3. merged batch artifact on `main` — completion

This avoids shared-state merge races during parallel review.

## Semantic authority

The only semantic authority for paraphrase eligibility is the Japanese prompt shown to the learner (`meaning_ja`).

Other fields may be inspected for deduplication or implementation integrity, but they must not redefine the prompt meaning.

A candidate is registered only when both are true:

1. it is a valid English answer to the Japanese prompt; and
2. teaching it as an additional expression has substantial learning value.

There is no minimum or maximum paraphrase count.

## Parallel writes

Batch workers write only their own batch artifact. They do not modify production `vocabulary-v3.json`, the global paraphrase audit file, runtime code, or app version.

After all 25 batch artifacts are merged, one finalizer claims:

`audit/paraphrase-learning-v1-finalize`

and performs reconciliation/materialization.
