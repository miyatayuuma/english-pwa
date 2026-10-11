import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJapanesePromptAuthorityMaterialization } from '../scripts/vocabulary/validate-japanese-prompt-authority-materialization.mjs';

test('Japanese Prompt Authority remediation is an exact 545-entry production projection', () => {
  const result = validateJapanesePromptAuthorityMaterialization();

  assert.equal(result.status, 'PASS');
  assert.equal(result.source_audit.branch, 'audit/vocabulary-japanese-prompt-authority-reconciliation');
  assert.equal(result.source_audit.commit, 'e5b2e42deebdcb750006a7871f805668f55de4bf');
  assert.equal(result.source_audit.authority_blob, 'cf5fa6a183b5ec96dc40cc1d9acff4ef70507c10');
  assert.deepEqual(result.production, {
    population: 2478,
    candidate_count: 545,
    PRE: 0,
    POST: 545,
    DRIFT: 0,
    source_blob: 'c23643d26e71be22aaec5ec04ce63a7582ad9c25',
  });
  assert.deepEqual(result.counts, {
    candidate_count: 545,
    meaning_ja_changed: 372,
    paraphrases_changed: 400,
    meaning_and_paraphrase_changed: 227,
    sense_key_changed: 1,
    canonical_changed: 0,
    answers_changed: 0,
    paraphrase_additions: 531,
    paraphrase_removals: 5,
  });
  assert.equal(result.non_target_differences, 0);
  assert.equal(result.forbidden_field_differences, 0);
  assert.equal(result.slot_defect_rows, 17);
  assert.equal(result.audit_status, 'CLOSED');
});
