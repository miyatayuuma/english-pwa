# Tagging migration roadmap

The target model is seven independent learning axes: speaker, situation/topic, grammar, construction, five sentence patterns, conversation function, and vocabulary/expression. Mentioned characters are stored separately from speakers so character presence never implies who is speaking.

## P0 — Freeze semantics and schema

Goal: prevent later retagging from mixing concepts again.

- Introduce tagging schema v3.
- Separate `speaker_tags` from `mentioned_character_tags`.
- Keep legacy `character_tags` only while the existing character browser still depends on it.
- Split grammatical constructions out of `grammar_tags` into `construction_tags`.
- Add `sentence_patterns: { main, clauses }` scaffold.
- Define grammar/construction parent groups.
- Add validation and CI tests.

Exit criteria: the enrichment pipeline can produce v3-compatible items without changing the current learning UI.

## P0.5 — Audio voice audit

Goal: classify the recorded game audio before assigning character speakers, so visual casting does not conflict with the voice actually heard.

- Keep voice analysis separate from character identity. Store perceived voice presentation, not a claim about the actor's gender identity.
- Classify each example audio as `masculine`, `feminine`, `mixed`, or `ambiguous` with confidence.
- For dialogue audio, preserve speaking order with turn-level `masculine`, `feminine`, or `ambiguous` labels.
- Use acoustic evidence such as F0 distribution together with the sentence/dialogue structure; do not classify from pitch alone.
- Store analysis in a separately editable dataset so a manual correction does not require retagging the sentence taxonomy.
- Send only ambiguous/low-confidence filenames and item IDs for manual listening review.

Exit criteria: every available example recording has a voice-presentation record or is explicitly queued for manual review.

## P1 — Speaker model and character cleanup

Goal: make character metadata mean who speaks, not who is merely discussed.

- Audit existing explicit/contextual character assignments.
- Populate high-confidence `speaker_tags` where the speaker can be inferred from local context.
- Populate `mentioned_character_tags` only from actual mentions.
- Allow two speakers for multi-party dialogue examples.
- Record source as `explicit`, `contextual`, or `app_cast` and confidence as `high` or `medium`.
- Constrain character assignment by the P0.5 audio voice presentation when recorded audio exists.
- Keep uncertain speaker slots empty rather than inventing canon.

Exit criteria: all high-confidence natural speaker assignments are separated from mentions and legacy character context.

## P2 — Grammar hierarchy and construction retagging

Goal: make the grammar browser pedagogically coherent.

- Reclassify existing grammar tags into parent groups: modal/future, tense/aspect, voice, clause relations, mood, sentence type.
- Move construction-like patterns such as `there is/are`, `It ... that`, `not so much A as B`, comparative correlation, `no sooner`, and causative `have` into `construction_tags`.
- Allow multiple tags in the same family when genuinely present.
- Use parent categories to solve sparse child tags instead of forcing atypical examples into them.
- Produce coverage and low-count reports for manual review.

Exit criteria: no construction tag remains in the grammar axis and sparse tags are reachable through useful parent groups.

## P3 — Cast all remaining examples

Goal: give every learning card a stable episodic speaker cue before the UI starts depending on speaker identity.

- Assign an app-original speaker to examples whose canonical speaker cannot be inferred.
- Use semantic fit, character profile fit, situation fit, audio voice presentation, and distribution balance.
- Never present `app_cast` assignments as source canon.
- Balance character frequency so a few main characters do not dominate all 560 examples.
- Keep provenance on every assignment so natural/contextual speakers remain distinguishable from app casting.

Exit criteria: every example has at least one speaker assignment, with provenance retained.

## P4 — Five sentence patterns

Goal: add structural sentence-pattern retrieval without pretending every example is a single simple clause.

- Add SV / SVC / SVO / SVOO / SVOC detection for the main clause.
- Store additional clause patterns in `sentence_patterns.clauses`.
- Mark ambiguous cases for manual review rather than forcing a label.
- Validate detector quality on a representative sample before full propagation.

Status: data-layer implementation complete. High-confidence parser results and reviewed overrides are propagated to `items.json`; uncertain or fragmentary cases remain unassigned and auditable in the review dataset. The normal enrichment pipeline reapplies the accepted P4 analysis so later v3 regeneration does not erase it.

Exit criteria: pattern tags are accurate enough to browse and to support future structural hints.

## P5 — Runtime/UI migration

Goal: expose the new data only after it is trustworthy.

- Change character browsing from legacy `character_tags` to `speaker_tags`.
- Add grammar hierarchy and a separate construction browser.
- Add a five-pattern browser.
- Show speaker artwork as a subtle card background; show two speakers for dialogue.
- Keep mentioned characters out of the speaker filter.
- Retire legacy `character_tags` once no runtime path depends on it.

Exit criteria: the app UI uses only v3 semantics.

## P6 — Coverage and learning-quality QA

Goal: tune the taxonomy after real use.

- Inspect counts per parent/child tag and per character.
- Review tags with very few examples and examples with excessive tagging.
- Check that multi-tag examples are genuinely representative.
- Verify speaker-background readability and memory-cue value.
- Adjust parent categories or casting distribution based on usage rather than padding tags artificially.

Exit criteria: tag collections are large enough to be useful, small tags remain meaningful, and no taxonomy axis is overloaded with a different concept.
