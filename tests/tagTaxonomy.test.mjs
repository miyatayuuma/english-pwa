import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  TAGGING_SCHEMA_VERSION,
  TAG_AXES,
  grammarParentFor,
  constructionParentFor,
  normalizeSentencePatterns,
  normalizeSpeakerTags,
  splitGrammarAndConstructionTags,
  validateTaggingV3Item,
} from '../scripts/tagging/tagTaxonomy.mjs';

test('v3 taxonomy separates speaker, mention, grammar, construction and sentence pattern axes',()=>{
  assert.equal(TAGGING_SCHEMA_VERSION,3);
  assert.equal(TAG_AXES.speaker.field,'speaker_tags');
  assert.equal(TAG_AXES.mentioned_character.field,'mentioned_character_tags');
  assert.equal(TAG_AXES.grammar.field,'grammar_tags');
  assert.equal(TAG_AXES.construction.field,'construction_tags');
  assert.equal(TAG_AXES.sentence_pattern.field,'sentence_patterns');
});

test('construction-like legacy grammar tags move out of grammar',()=>{
  const split=splitGrammarAndConstructionTags([
    'passive_voice','there_be','not_so_much_as','present_perfect','causative_have','there_be',
  ]);
  assert.deepEqual(split.grammar,['passive_voice','present_perfect']);
  assert.deepEqual(split.construction,['there_be','not_so_much_as','causative_have']);
  assert.equal(grammarParentFor('passive_voice'),'voice');
  assert.equal(grammarParentFor('present_perfect'),'tense_aspect');
  assert.equal(constructionParentFor('there_be'),'existential');
  assert.equal(constructionParentFor('not_so_much_as'),'comparison');
});

test('speaker tags preserve source semantics and deduplicate by strongest evidence',()=>{
  const speakers=normalizeSpeakerTags([
    {id:'bob',source:'app_cast',confidence:'medium'},
    {id:'bob',source:'contextual',confidence:'high'},
    {id:'jennifer',source:'explicit',confidence:'high'},
    {id:'invalid',source:'guess',confidence:'low'},
  ]);
  assert.deepEqual(speakers,[
    {id:'bob',source:'contextual',confidence:'high'},
    {id:'jennifer',source:'explicit',confidence:'high'},
  ]);
});

test('sentence patterns allow a main clause plus multiple embedded clause patterns',()=>{
  assert.deepEqual(
    normalizeSentencePatterns({main:'SVO',clauses:['SVC','SVO','SVC','INVALID']}),
    {main:'SVO',clauses:['SVC','SVO']},
  );
  assert.deepEqual(normalizeSentencePatterns(null),{main:null,clauses:[]});
});

test('v3 validation rejects mixed grammar/construction semantics',()=>{
  const base={
    id:'E0001',
    character_tags:[],
    mentioned_character_tags:[],
    speaker_tags:[],
    situation_tags:['general'],
    grammar_tags:['passive_voice'],
    construction_tags:['there_be'],
    sentence_patterns:{main:null,clauses:[]},
    function_tags:[],
  };
  assert.deepEqual(validateTaggingV3Item(base),[]);
  const bad={...base,grammar_tags:['there_be']};
  assert.ok(validateTaggingV3Item(bad).some(error=>error.includes('construction tag remains')));
});

test('tagging enrichment script remains syntactically valid without executing data writes',()=>{
  const path=fileURLToPath(new URL('../scripts/tagging/enrich-items.mjs',import.meta.url));
  execFileSync(process.execPath,['--check',path],{stdio:'pipe'});
});
