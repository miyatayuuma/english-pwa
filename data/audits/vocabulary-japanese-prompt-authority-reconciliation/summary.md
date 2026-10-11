# Japanese Prompt Authority Reconciliation — Progress Accounting

Status: **CLOSED**. Semantic review, latest-main reconciliation, and strict final validation are complete. This file is a deterministic human-readable projection of checkpoint.json.

- Audit base: `9007e2f59cc6bfc48e7021caa3b469dae89adb60`
- Progress generated from branch head: `8af36e0da1bdbaa07d1e77b76221d640044a161d`
- Union: 589; REVIEWED 589; UPSTREAM 0; PENDING 0; resolved 589
- Dispositioned: 589/589; PENDING 0
- Entry decisions: KEEP 40; PROMPT_SIMPLIFY 142; PARAPHRASE_RESTORE 173; PROMPT_AND_PARAPHRASE_RECONCILE 231; PARAPHRASE_REMOVE_SEMANTIC 3; UPSTREAM_AUTHORITY_REVIEW 0
- Parenthetical decisions: REMOVE_META_HINT 248; REWRITE_MINIMAL_SEMANTIC 120; KEEP_SEMANTIC_SCOPE 8; UPSTREAM_MEANING_REVIEW 0
- Parallel worker wave: COMPLETE; 548 judgments from 10 workers; production changes 0
- Reviewed-entry confidence: HIGH 438; MEDIUM 151; LOW 0; missing 0
- Current parenthetical: 376; reviewed 376; upstream 0; pending 0; resolved 376
- Parenthetical decisions fully dispositioned: 376/376 entries; 381 current segments
- Previous materialized IDs: 551; reviewed 551; upstream 0; pending 0; resolved 551
- Historical removed phrases: 670; RESTORE 531; KEEP_REMOVED_SEMANTIC_MISMATCH 139; UPSTREAM_REVIEW 0; PENDING 0
- Historical added phrases: 8; checked 8; KEEP 8; REMOVE 0; UPSTREAM_REVIEW 0; PENDING 0
- Current paraphrase review (kept separate): 300; resolved 300; pending 0
- Historical removals fully dispositioned: 670/670
- Historical additions fully dispositioned: 8/8
- Current paraphrases fully dispositioned: 300/300; worker new additions 0
- Target leakage: found 5; resolved 5; pending 0
- Meta-hint: found 243; resolved 243; upstream 0; pending 0
- Full production slot inventory: 2478; token-bearing entries 526; VARIABLE_SLOT entries 504; LEXICAL_TOKEN entries 17; AMBIGUOUS entries 1 (resolved 1)
- Slot candidates: 19; reviewed 19; upstream 0; pending 0; confirmed defect entries 17; unresolved 0
- Confirmed slot violations: {"SLOT_MISSING":12,"SLOT_REPLACED_BY_EXAMPLE":8,"SLOT_REPLACED_BY_META_SCOPE":0,"SLOT_TYPE_MISMATCH":0,"SLOT_COUNT_MISMATCH":12,"SLOT_ROLE_MISMATCH":0,"SLOT_OVERCONSTRAINED":5,"AMBIGUOUS_SLOT_AUTHORITY":0}
- Union slot gate: 589/589; pending 0; reviewed-40 slot-bearing checked 8; reviewed-40 reconciliations 0
- Historical materialization divergence: 340 entries; field mismatches {"meaning_ja":0,"canonical":0,"sense_key":0,"grammarRole":0,"paraphrases":340}. Informational only; these are not stale entries.
- Stale since audit base on current main (9007e2f59cc6bfc48e7021caa3b469dae89adb60): 0
- Slot integrity: 589/589 checked; confirmed defects integrated 17; unresolved conflicts 0
- Production changes: 0; production unchanged; worker judgments imported: 548
- Audit closure: CLOSED
- Latest-main reconciliation: COMPLETE; final SHA 9007e2f59cc6bfc48e7021caa3b469dae89adb60
- Strict final validation: PASS
- Production materialization: NOT_STARTED; production changes 0
- Per-batch review: batch-001 100/0/0; batch-002 100/0/0; batch-003 100/0/0; batch-004 100/0/0; batch-005 100/0/0; batch-006 89/0/0 (reviewed/upstream/pending)
- Next step: Next task: Japanese Prompt Authority Production Materialization.
