# Japanese Prompt Authority Reconciliation — Progress Accounting

Status: **IN PROGRESS**. This file is a deterministic human-readable projection of `checkpoint.json`.

- Audit base: `9007e2f59cc6bfc48e7021caa3b469dae89adb60`
- Progress generated from branch head: `8e6de9cb8cec9419d733231beae178fea001b11a`
- Union: 589; REVIEWED 40; UPSTREAM 1; PENDING 548; resolved 41
- Current parenthetical: 376; reviewed 38; upstream 1; pending 337; resolved 39
- Previous materialized IDs: 551; reviewed 31; upstream 1; pending 519; resolved 32
- Historical removed phrases: 670; RESTORE 14; KEEP_REMOVED_SEMANTIC_MISMATCH 12; UPSTREAM_REVIEW 0; PENDING 644
- Historical added phrases: 8; checked 1; KEEP 1; REMOVE 0; UPSTREAM_REVIEW 0; PENDING 7
- Current paraphrase review (kept separate): 300; resolved 26; pending 274
- Target leakage: found 5; resolved 5; pending 0
- Meta-hint: found 26; resolved 25; upstream 1; pending 0
- Full production slot inventory: 2478; token-bearing entries 526; VARIABLE_SLOT entries 504; LEXICAL_TOKEN entries 17; AMBIGUOUS entries 1 (resolved 1)
- Slot candidates: 19; reviewed 19; upstream 0; pending 0; confirmed defect entries 17; unresolved 0
- Confirmed slot violations: {"SLOT_MISSING":12,"SLOT_REPLACED_BY_EXAMPLE":8,"SLOT_REPLACED_BY_META_SCOPE":0,"SLOT_TYPE_MISMATCH":0,"SLOT_COUNT_MISMATCH":12,"SLOT_ROLE_MISMATCH":0,"SLOT_OVERCONSTRAINED":5,"AMBIGUOUS_SLOT_AUTHORITY":0}
- Union slot gate: 589/589; pending 0; reviewed-40 slot-bearing checked 8; reviewed-40 reconciliations 0
- Historical materialization divergence: 340 entries; field mismatches {"meaning_ja":0,"canonical":0,"sense_key":0,"grammarRole":0,"paraphrases":340}. Informational only; these are not stale entries.
- Stale since audit base on current main (9007e2f59cc6bfc48e7021caa3b469dae89adb60): 0
- Production changes: 0; semantic decision changes in this accounting repair: 0
- Per-batch review: batch-001 34/1/65; batch-002 0/0/100; batch-003 1/0/99; batch-004 2/0/98; batch-005 0/0/100; batch-006 3/0/86 (reviewed/upstream/pending)
- Next step: Continue semantic review of the 548 PENDING union entries with the slot integrity gate applied. Keep vocab:00083 isolated for upstream authority review; do not mark the audit closed.
