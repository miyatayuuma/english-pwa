import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVocabularyV3 } from '../scripts/vocabulary/validate-vocabulary-v3.mjs';

const item={id:'E1',en:'take up',ja:'場所を取る',speaker_tags:[{id:'alice'}]};
const characters=[{id:'alice',name:'Alice'}];
const entry={id:'vocab:00001',kind:'expression',subtype:'phrasal_verb',canonical:'take up',sense_key:'occupy_space',pos:'verb',meaning_ja:'場所を占める',occurrences:[{item_id:'E1',start:0,end:7,contextual_meaning_ja:'場所を取る'}]};
const validate=(db,items=[item],chars=characters,migration={schema_version:1,mappings:[]},v2={entries:[],stats:{ready_for_cards:0}})=>validateVocabularyV3(db,items,chars,migration,v2);

test('valid v3 schema accepts the exact source span and separate occurrence meaning',()=>{
  const result=validate({schema_version:3,entries:[entry]});
  assert.deepEqual(result.errors,[]);
  assert.equal(result.report.total_entries,1);
  assert.equal(result.report.occurrence_count,1);
});

test('duplicate IDs and duplicate canonical plus sense keys fail validation',()=>{
  const duplicate={...entry,id:'vocab:00001'};
  const result=validate({schema_version:3,entries:[entry,duplicate]});
  assert.ok(result.errors.some(error=>error.includes('duplicate id')));
  assert.ok(result.errors.some(error=>error.includes('duplicate canonical+sense_key')));
});

test('unknown source items, out-of-range spans, and empty contextual meanings fail',()=>{
  const unknown={...entry,id:'vocab:00002',occurrences:[{...entry.occurrences[0],item_id:'E404'}]};
  const range={...entry,id:'vocab:00003',occurrences:[{...entry.occurrences[0],start:2,end:99}]};
  const noContext={...entry,id:'vocab:00004',occurrences:[{...entry.occurrences[0],contextual_meaning_ja:'  '}]};
  const result=validate({schema_version:3,entries:[unknown,range,noContext]});
  assert.ok(result.errors.some(error=>error.includes('unknown item E404')));
  assert.ok(result.errors.some(error=>error.includes('invalid UTF-16 span')));
  assert.ok(result.errors.some(error=>error.includes('empty contextual meaning')));
});

test('legacy notation, unknown kinds, and unknown subtypes are rejected',()=>{
  const malformed={...entry,id:'vocab:00005',canonical:'take A/B ~ (1)',kind:'expression',subtype:'bad_subtype'};
  const unknownKind={...entry,id:'vocab:00006',kind:'phrase',subtype:undefined};
  const result=validate({schema_version:2,entries:[malformed,unknownKind]});
  assert.ok(result.errors.some(error=>error.includes('dictionary notation')));
  assert.ok(result.errors.some(error=>error.includes('unknown subtype')));
  assert.ok(result.errors.some(error=>error.includes('unknown kind')));
  assert.ok(result.errors.some(error=>error.includes('schema_version')));
});

test('invalid speaker joins are reported without runtime fallback assumptions',()=>{
  const result=validate({schema_version:3,entries:[entry]},[{...item,speaker_tags:[{id:'missing-character'}]}],characters);
  assert.ok(result.errors.some(error=>error.includes('unknown speaker character')));
});

test('source sentence and speaker data cannot be duplicated into vocabulary entries',()=>{
  const result=validate({schema_version:3,entries:[{...entry,en:item.en,occurrences:[{...entry.occurrences[0],speaker_id:'alice'}]}]});
  assert.ok(result.errors.some(error=>error.includes('unapproved entry field en')));
  assert.ok(result.errors.some(error=>error.includes('unapproved occurrence field speaker_id')));
});

test('migration requires a matching lexical expression, source sentence, sense, and POS review',()=>{
  const map={schema_version:1,mappings:[{
    v2_id:'duo:1:4',v3_id:entry.id,item_id:'E1',same_sense_confirmed:true,
    same_expression_confirmed:true,pos_compatible_confirmed:true,
  }]};
  const old={entries:[{id:'duo:1:4',headword:'Take up!',example_ids:['E1'],examples:[{item_id:'E1',en:'take up'}]}]};
  assert.deepEqual(validate({schema_version:3,entries:[entry]},[item],characters,map,old).errors,[]);
  old.entries[0].headword='turn off';
  const errors=validate({schema_version:3,entries:[entry]},[item],characters,map,old).errors;
  assert.ok(errors.some(error=>error.includes('lexical expression mismatch')));
});
