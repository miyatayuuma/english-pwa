# Japanese Prompt Authority Reconciliation — Partial Review

Status: **IN PROGRESS**. The frozen union contains 589 entries. 40 entries are semantically reviewed and 1 are explicitly isolated for upstream authority review; 548 remain pending.

- Audit base: `9007e2f59cc6bfc48e7021caa3b469dae89adb60`
- Current parenthetical entries: 376; reviewed 38; upstream isolated 1; pending 337
- Previous materialized IDs: 551; reviewed 31; upstream isolated 1; pending 519
- Historical removed pairs: 670; dispositioned 26 (RESTORE 14, semantic mismatch 12); pending 644
- Historical additions checked: 1 / 8
- Target leakage found/resolved: 5/5
- Meta-hint cases found/resolved: 26/25
- Upstream isolated: vocab:00083 (the Japanese source prompt combines disbelief and refusal)
- Production changes: 0

The historical `cow` removal is retained for a concrete semantic mismatch: Cambridge defines `cow` as an adult female bovine, narrower than unqualified Japanese 「牛」. The obsolete collective/plural hint is still removed from the prompt. This is a partial checkpoint; no strict final validator or deterministic regeneration has run.
