import assert from 'node:assert/strict';
import test from 'node:test';
import { applySentencePatternAnalysis, sentencePatternReportPatch, validateSentencePatternAnalysis } from '../scripts/tagging/sentencePatternApplication.mjs';

const items=[
  {id:'A',sentence_patterns:{main:null,clauses:[]}},
  {id:'B',sentence_patterns:{main:null,clauses:[]}},
];
const analysis={
  summary:{review_item_count:1,gold:{accuracy:0.9}},
  entries:[
    {id:'A',main:{pattern:'SVO',accepted:true},clauses:[{pattern:'SVC',accepted:true},{pattern:'SVC',accepted:true}]},
    {id:'B',main:{pattern:'SVOC',accepted:false},clauses:[{pattern:'SV',accepted:true}]},
  ],
};

test('applies only accepted sentence patterns and deduplicates clause labels',()=>{
  const next=applySentencePatternAnalysis(items,analysis);
  assert.deepEqual(next[0].sentence_patterns,{main:'SVO',clauses:['SVC']});
  assert.deepEqual(next[1].sentence_patterns,{main:null,clauses:['SV']});
});

test('reports coverage without forcing unresolved main patterns',()=>{
  const next=applySentencePatternAnalysis(items,analysis);
  assert.deepEqual(sentencePatternReportPatch(next,analysis),{
    sentence_pattern_tagged_items:2,
    sentence_pattern_main_tagged_items:1,
    sentence_pattern_main_unresolved:1,
    sentence_pattern_review_items:1,
    sentence_pattern_counts:{SVO:1},
    sentence_pattern_clause_counts:{SVC:1,SV:1},
    sentence_pattern_gold_accuracy:0.9,
  });
});

test('rejects incomplete or invalid analysis payloads',()=>{
  assert.ok(validateSentencePatternAnalysis(items,{entries:[]}).length>0);
  assert.ok(validateSentencePatternAnalysis(items,{entries:[
    {id:'A',main:{pattern:'BAD',accepted:true},clauses:[]},
    {id:'B',main:{pattern:'SV',accepted:true},clauses:[]},
  ]}).length>0);
});
