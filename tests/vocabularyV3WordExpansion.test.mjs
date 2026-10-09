import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateVocabularyV3 } from '../scripts/vocabulary/validate-vocabulary-v3.mjs';

const load=path=>JSON.parse(fs.readFileSync(new URL(path,import.meta.url),'utf8'));
const items=load('../data/items.json');
const db=load('../data/vocabulary-v3.json');
const audit=load('../data/vocabulary-v3-word-audit.json');
const nuanceMaterialization=load('../data/audits/vocabulary-single-entry-nuance-materialization/materialization.json');
const itemById=new Map(items.map(item=>[item.id,item]));
const wordEntries=db.entries.filter(entry=>entry.kind==='word'&&audit.cohort_word_entry_ids.includes(entry.id));
const word=(canonical,senseKey)=>wordEntries.find(entry=>entry.canonical===canonical&&entry.sense_key===senseKey);
function occurrence(value,itemId){
  const found=value?.occurrences.find(candidate=>candidate.item_id===itemId);
  assert.ok(found,`${value?.canonical}/${value?.sense_key} occurs in ${itemId}`);
  const source=itemById.get(itemId);
  assert.ok(source,`${itemId} exists`);
  return {...found,surface:source.en.slice(found.start,found.end)};
}

test('word audit manifest covers every source item and accounts for persistent added IDs',()=>{
  assert.equal(audit.source_items_reviewed,560);
  assert.deepEqual(audit.reviewed_source_item_ids,items.map(item=>item.id));
  assert.equal(audit.word_entries_before,42);
  assert.equal(audit.word_entries_added,audit.added_word_entry_ids.length);
  assert.equal(wordEntries.length,audit.word_entries_before+audit.word_entries_added);
  assert.equal(new Set(db.entries.map(entry=>entry.id)).size,db.entries.length);
  assert.ok(audit.added_word_entry_ids.every(id=>wordEntries.some(entry=>entry.id===id)));
  assert.equal(audit.existing_word_span_corrections.length,21);
});

test('every word occurrence, including retained v3 entries, spans one lexical token',()=>{
  for(const entry of wordEntries) for(const candidate of entry.occurrences){
    const source=itemById.get(candidate.item_id);
    assert.ok(source,`${entry.id} source exists`);
    const surface=source.en.slice(candidate.start,candidate.end);
    assert.equal(/\s/.test(surface),false,`${entry.id} points only to its lexical token`);
  }
  assert.equal(word('awkward','socially_uncomfortable').occurrences[0].end-word('awkward','socially_uncomfortable').occurrences[0].start,7);
});

test('new word fixtures preserve source sense, part of speech, and exact inflected spans',()=>{
  const fixtures=[
    ['breakthrough','important_advance_or_discovery','noun','E0052','breakthroughs',/飛躍的な進歩/],
    ['benefit','good_effect_or_advantage','noun','E0052','benefits',/恩恵/],
    ['humanity','human_race','noun','E0052','humanity',/人類/],
    ['defeat','win_against_in_a_contest','verb','E0087','defeat',/打ち負かす/],
    ['opponent','person_you_compete_against','noun','E0087','opponent',/対戦相手/],
    ['skepticism','attitude_of_doubt','noun','E0404','skepticism',/懐疑/],
    ['drag','pull_with_force','verb','E0521','dragged',/引きずる/],
    ['pause','brief_stop','noun','E0521','pause',/中断/],
    ['upstairs','to_or_on_an_upper_floor','adverb','E0521','upstairs',/階上/],
    ['nevertheless','despite_what_was_just_said','adverb','E0404','Nevertheless',/それにもかかわらず/],
    ['linger','remain_for_a_long_time','verb','E0404','lingers',/残る/],
    ['shrink','become_smaller','verb','E0106','shrank',/縮む/],
    ['alarming','causing_worry','adjective','E0032','alarming',/不安/],
    ['exhausted','very_tired','adjective','E0123','exhausted',/疲れ切/],
    ['thriving','flourishing_or_successful','adjective','E0267','thriving',/盛ん/],
    ['be familiar with something','knowledgeable_about_a_subject','adjective','E0015','familiar',/精通/],
    ['familiar','known_to_someone','adjective','E0486','familiar',/なじみ/],
    ['passionately','with_strong_feeling_or_emotion','adverb','E0524','passionately',/情熱的/],
  ];
  for(const [canonical,senseKey,pos,itemId,surface,meaning] of fixtures){
    const entry=word(canonical,senseKey);
    assert.ok(entry,`${canonical}/${senseKey} retained`);
    assert.equal(entry.pos,pos,`${canonical} part of speech`);
    assert.match(entry.meaning_ja,meaning,`${canonical} representative meaning`);
    const found=occurrence(entry,itemId);
    assert.equal(found.surface,surface,`${canonical} exact source span`);
    assert.ok(found.contextual_meaning_ja.trim(),`${canonical} contextual meaning`);
  }
});

test('homographic word senses remain separate and same-sense words consolidate occurrences',()=>{
  const split=[
    ['charge',['fee_for_a_service','responsibility_or_control']],
    ['favor',['act_of_help','support_or_approval']],
    ['rate',['proportion_or_frequency','speed_or_degree_of_change']],
    ['suspect',['believe_someone_may_be_guilty_or_involved','person_believed_to_have_committed_a_crime']],
  ];
  for(const [canonical,senses] of split){
    for(const sense of senses) assert.ok(word(canonical,sense),`${canonical}/${sense} has its own sense entry`);
  }
  for(const example of audit.same_sense_multi_occurrence_examples){
    const entry=word(example.canonical,example.sense_key);
    assert.ok(entry,`${example.canonical} entry exists`);
    assert.deepEqual(entry.occurrences.map(value=>value.item_id),example.item_ids);
  }
});

test('manifest records useful inclusions and principled exclusions',()=>{
  assert.ok(audit.retained_examples.some(example=>example.canonical==='awkward'&&example.item_id==='E0521'));
  assert.ok(audit.accepted_examples.some(example=>example.canonical==='breakthrough'&&example.item_id==='E0052'));
  assert.ok(audit.accepted_examples.some(example=>example.canonical==='drag'&&example.surface==='dragged'));
  assert.ok(audit.rejected_examples.some(example=>example.surface==='good'&&/basic|elementary/i.test(example.reason)));
  assert.ok(audit.rejected_examples.some(example=>example.surface==='up'&&/particle|phrasal verb/i.test(example.reason)));
  for(const example of audit.rejected_examples){
    assert.equal(wordEntries.some(entry=>entry.canonical.toLowerCase()===example.surface.toLowerCase()),false,`${example.surface} remains excluded`);
  }
});

test('word expansion report semantics validate against the current source and vocabulary data',()=>{
  const migration=load('../data/vocabulary-v2-v3-migration.json');
  const v2=load('../data/vocabulary-v2.json');
  const characters=load('../data/characters.json').characters||[];
  const result=validateVocabularyV3(db,items,characters,migration,v2,audit,null,nuanceMaterialization);
  assert.deepEqual(result.errors,[]);
  const report=result.report.word_expansion_audit;
  assert.equal(report.word_entries_after,381);
  assert.equal(report.word_entries_added,339);
  assert.equal(report.source_items_with_word_entries,261);
  assert.equal(report.source_items_newly_covered_by_words,222);
  assert.equal(report.multi_occurrence_word_entries,3);
  assert.equal(report.multi_sense_word_canonical_count,4);
  assert.equal(report.existing_word_span_correction_count,21);
});
