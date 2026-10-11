import fs from 'node:fs';
import { assertTdCurrentMainReconciliation, buildTdCurrentMainReconciliation, gitBlobSha, TD_CURRENT_MAIN_BASELINE } from './vocabularyTdClusterCurrentMainReconciliation.js';
import { VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY } from './vocabularyTdClusterBeforeToAuthority.js';

const root = new URL('../../', import.meta.url);
const readBytes = path => fs.readFileSync(new URL(path, root));
const materializationBytes = readBytes('data/audits/vocabulary-td-cluster-before-to-production/materialization.json');
const vocabularyBytes = readBytes('data/vocabulary-v3.json');
const itemsBytes = readBytes('data/items.json');
const sourceBlobShas = {
  'data/vocabulary-v3.json': gitBlobSha(vocabularyBytes),
  'data/items.json': gitBlobSha(itemsBytes),
};
if (gitBlobSha(materializationBytes) !== TD_CURRENT_MAIN_BASELINE.historicalMaterializationBlob) {
  throw new Error('historical T/D materialization changed; refusing to rewrite or reconcile it');
}

const materialization = JSON.parse(materializationBytes.toString('utf8'));
const entries = JSON.parse(vocabularyBytes.toString('utf8')).entries;
const items = JSON.parse(itemsBytes.toString('utf8'));
const expected = buildTdCurrentMainReconciliation({
  artifact: materialization,
  entries,
  items,
  rules: VOCABULARY_TD_CLUSTER_BEFORE_TO_AUTHORITY,
  sourceBlobShas,
});
const outputPath = new URL('data/audits/vocabulary-td-cluster-before-to-production/current-main-reconciliation.json', root);
if (process.argv.includes('--write')) {
  fs.writeFileSync(outputPath, `${JSON.stringify(expected, null, 2)}\n`);
} else {
  const actual = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assertTdCurrentMainReconciliation(actual, expected);
}

console.log(JSON.stringify({
  status: 'PASS',
  mode: process.argv.includes('--write') ? 'WRITE' : 'CHECK',
  reconciledMainSha: expected.reconciled_main_sha,
  counts: expected.counts,
  relocated: expected.records.filter(record => record.current.state === 'INDEX_RELOCATED').map(record => ({
    auditCandidateId: record.audit_candidate_id,
    historicalRef: record.historical.surface_ref,
    currentRef: record.current.current_ref,
  })),
}, null, 2));
