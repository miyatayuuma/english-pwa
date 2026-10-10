# Japanese Prompt Authority Reconciliation — Progress Accounting

Status: **IN PROGRESS**. This file is a deterministic human-readable projection of `checkpoint.json`.

- Audit base: `9007e2f59cc6bfc48e7021caa3b469dae89adb60`
- Progress generated from branch head: `b634517228346a8e9197fa814d3c530aeb71b367`
- Union: 589; REVIEWED 40; UPSTREAM 1; PENDING 548; resolved 41
- Current parenthetical: 376; reviewed 38; upstream 1; pending 337; resolved 39
- Previous materialized IDs: 551; reviewed 31; upstream 1; pending 519; resolved 32
- Historical removed phrases: 670; RESTORE 14; KEEP_REMOVED_SEMANTIC_MISMATCH 12; UPSTREAM_REVIEW 0; PENDING 644
- Historical added phrases: 8; checked 1; KEEP 1; REMOVE 0; UPSTREAM_REVIEW 0; PENDING 7
- Current paraphrase review (kept separate): 300; resolved 26; pending 274
- Target leakage: found 5; resolved 5; pending 0
- Meta-hint: found 26; resolved 25; upstream 1; pending 0
- Historical materialization divergence: 340 entries; field mismatches {"meaning_ja":0,"canonical":0,"sense_key":0,"grammarRole":0,"paraphrases":340}. Informational only; these are not stale entries.
- Stale since audit base on current main (9007e2f59cc6bfc48e7021caa3b469dae89adb60): 0
- Production changes: 0; semantic decision changes in this accounting repair: 0
- Per-batch review: batch-001 34/1/65; batch-002 0/0/100; batch-003 1/0/99; batch-004 2/0/98; batch-005 0/0/100; batch-006 3/0/86 (reviewed/upstream/pending)
- Next step: Continue parallel semantic review of the 548 PENDING union entries. Keep vocab:00083 isolated for upstream authority review; do not mark the audit closed.
