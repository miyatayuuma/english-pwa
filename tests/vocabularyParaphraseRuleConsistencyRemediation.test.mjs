import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildVocabularySession,collapseDuplicateVocabularyCards,vocabularyStats} from '../scripts/app/vocabularyLearningCore.js';

const db=JSON.parse(fs.readFileSync(new URL('../data/vocabulary-v3.json',import.meta.url),'utf8'));
const paraphraseAudit=JSON.parse(fs.readFileSync(new URL('../data/vocabulary-v3-paraphrase-audit.json',import.meta.url),'utf8'));
const items=JSON.parse(fs.readFileSync(new URL('../data/items.json',import.meta.url),'utf8'));
const ruleAuditDir='../data/audits/vocabulary-paraphrase-rule-consistency/';
const readRuleAudit=name=>JSON.parse(fs.readFileSync(new URL(`${ruleAuditDir}${name}`,import.meta.url),'utf8'));
const ruleManifest=readRuleAudit('manifest.json');
const candidates=readRuleAudit('candidates.json');
const confirmed=readRuleAudit('confirmed.json');
const review=readRuleAudit('review.json');
const falsePositive=readRuleAudit('false-positive.json');
const materialization=readRuleAudit('materialization.json');
const nuanceMaterialization=JSON.parse(fs.readFileSync(new URL('../data/audits/vocabulary-single-entry-nuance-materialization/materialization.json',import.meta.url),'utf8'));
const nuanceById=new Map(nuanceMaterialization.entries.map(row=>[row.id,row]));
const expected=[
  {
    "id": "vocab:00121",
    "meaning_ja": "somethingにもかかわらず",
    "canonical": "despite something",
    "paraphrases": [
      "in spite of something"
    ],
    "grammarRole": "preposition"
  },
  {
    "id": "vocab:00217",
    "meaning_ja": "somethingを見せびらかす",
    "canonical": "show something off",
    "paraphrases": [
      "flaunt something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00219",
    "meaning_ja": "someoneをうらやむ",
    "canonical": "envy someone",
    "paraphrases": [
      "be envious of someone"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00266",
    "meaning_ja": "someoneに仕返しをする",
    "canonical": "get even with someone",
    "paraphrases": [
      "get revenge on someone",
      "get back at someone",
      "take revenge on someone"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00328",
    "meaning_ja": "somethingはsomething elseと関係がある",
    "canonical": "something has something to do with something else",
    "paraphrases": [
      "something is related to something else"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00552",
    "meaning_ja": "今にも",
    "canonical": "at any moment",
    "paraphrases": [
      "any minute now"
    ],
    "grammarRole": "adverb"
  },
  {
    "id": "vocab:00689",
    "meaning_ja": "somethingに加えて",
    "canonical": "besides something",
    "paraphrases": [
      "in addition to something",
      "as well as something"
    ],
    "grammarRole": "preposition"
  },
  {
    "id": "vocab:00690",
    "meaning_ja": "somethingを手配する",
    "canonical": "make arrangements for something",
    "paraphrases": [
      "arrange something",
      "set something up"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00707",
    "meaning_ja": "someoneを軽蔑する",
    "canonical": "despise someone",
    "paraphrases": [
      "look down on someone",
      "scorn someone"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00747",
    "meaning_ja": "somethingに精通している",
    "canonical": "be familiar with something",
    "paraphrases": [
      "know something well",
      "be well versed in something",
      "be knowledgeable about something"
    ],
    "grammarRole": "adjective"
  },
  {
    "id": "vocab:00760",
    "meaning_ja": "someoneと妥協する",
    "canonical": "compromise with someone",
    "paraphrases": [
      "meet someone halfway"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00778",
    "meaning_ja": "someoneをsomethingにさらす",
    "canonical": "expose someone to something",
    "paraphrases": [
      "subject someone to something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00853",
    "meaning_ja": "somethingに投資する",
    "canonical": "invest in something",
    "paraphrases": [
      "put money into something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00863",
    "meaning_ja": "somethingするのを切望している",
    "canonical": "be anxious to do something",
    "paraphrases": [
      "be eager to do something"
    ],
    "grammarRole": "adjective"
  },
  {
    "id": "vocab:00933",
    "meaning_ja": "somethingに寄与する",
    "canonical": "contribute to something",
    "paraphrases": [
      "play a part in something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00951",
    "meaning_ja": "somethingに値する",
    "canonical": "deserve something",
    "paraphrases": [
      "be worth something",
      "be worthy of something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00967",
    "meaning_ja": "someoneを搾取する",
    "canonical": "exploit someone",
    "paraphrases": [
      "take advantage of someone"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00985",
    "meaning_ja": "somethingを我慢する",
    "canonical": "tolerate something",
    "paraphrases": [
      "put up with something",
      "endure something",
      "bear something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:00988",
    "meaning_ja": "someoneからsomethingを奪う",
    "canonical": "deprive someone of something",
    "paraphrases": [
      "take something away from someone",
      "seize something from someone",
      "rob someone of something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01007",
    "meaning_ja": "someoneをsomethingのことで告発する",
    "canonical": "accuse someone of something",
    "paraphrases": [
      "charge someone with something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01057",
    "meaning_ja": "somethingを後悔する",
    "canonical": "regret something",
    "paraphrases": [
      "be sorry about something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01067",
    "meaning_ja": "somethingを延期する",
    "canonical": "postpone something",
    "paraphrases": [
      "delay something",
      "put something off",
      "defer something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01088",
    "meaning_ja": "somethingを組み合わせる",
    "canonical": "combine something",
    "paraphrases": [
      "put something together"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01110",
    "meaning_ja": "somethingに気づく",
    "canonical": "realize something",
    "paraphrases": [
      "notice something",
      "become aware of something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01240",
    "meaning_ja": "someoneにお世辞を言う",
    "canonical": "flatter someone",
    "paraphrases": [
      "butter someone up"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01293",
    "meaning_ja": "somethingではなくsomething else",
    "canonical": "not something but something else",
    "paraphrases": [
      "something else rather than something",
      "something else instead of something"
    ],
    "grammarRole": "construction"
  },
  {
    "id": "vocab:01513",
    "meaning_ja": "somethingを間違える",
    "canonical": "make a mistake in something",
    "paraphrases": [
      "get something wrong"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01538",
    "meaning_ja": "somewhereへ向かう",
    "canonical": "head somewhere",
    "paraphrases": [
      "make for somewhere"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01645",
    "meaning_ja": "somethingの至る所に",
    "canonical": "all over something",
    "paraphrases": [
      "throughout something"
    ],
    "grammarRole": "preposition"
  },
  {
    "id": "vocab:01651",
    "meaning_ja": "一連のsomething",
    "canonical": "a series of something",
    "paraphrases": [
      "a sequence of something"
    ],
    "grammarRole": "determiner"
  },
  {
    "id": "vocab:01656",
    "meaning_ja": "somethingで役割を果たす",
    "canonical": "play a role in something",
    "paraphrases": [
      "play a part in something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01657",
    "meaning_ja": "somethingの瀬戸際に",
    "canonical": "on the verge of something",
    "paraphrases": [
      "on the brink of something"
    ],
    "grammarRole": "preposition"
  },
  {
    "id": "vocab:01658",
    "meaning_ja": "somethingに損害を与える",
    "canonical": "do damage to something",
    "paraphrases": [
      "damage something",
      "cause damage to something",
      "harm something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01662",
    "meaning_ja": "somethingが原因である",
    "canonical": "be due to something",
    "paraphrases": [
      "be caused by something",
      "result from something",
      "stem from something"
    ],
    "grammarRole": "adjective"
  },
  {
    "id": "vocab:01665",
    "meaning_ja": "somethingと関係がある",
    "canonical": "be related to something",
    "paraphrases": [
      "be connected with something",
      "be associated with something"
    ],
    "grammarRole": "adjective"
  },
  {
    "id": "vocab:01673",
    "meaning_ja": "somethingが豊富である",
    "canonical": "be rich in something",
    "paraphrases": [
      "abound in something"
    ],
    "grammarRole": "adjective"
  },
  {
    "id": "vocab:01674",
    "meaning_ja": "somethingに特有である",
    "canonical": "be characteristic of something",
    "paraphrases": [
      "be unique to something",
      "be peculiar to something"
    ],
    "grammarRole": "adjective"
  },
  {
    "id": "vocab:01676",
    "meaning_ja": "somethingに似ている",
    "canonical": "be similar to something",
    "paraphrases": [
      "resemble something"
    ],
    "grammarRole": "adjective"
  },
  {
    "id": "vocab:01708",
    "meaning_ja": "somethingに気づく",
    "canonical": "notice something",
    "paraphrases": [
      "realize something",
      "become aware of something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01731",
    "meaning_ja": "somethingを組み立てる",
    "canonical": "assemble something",
    "paraphrases": [
      "put something together"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01734",
    "meaning_ja": "somethingに取って代わる",
    "canonical": "replace something",
    "paraphrases": [
      "take the place of something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01741",
    "meaning_ja": "somethingを取り去る",
    "canonical": "remove something",
    "paraphrases": [
      "take something away"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01754",
    "meaning_ja": "somethingをなんとか成し遂げる",
    "canonical": "manage to do something",
    "paraphrases": [
      "pull something off"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01762",
    "meaning_ja": "somethingについて責任を負っている",
    "canonical": "be responsible for something",
    "paraphrases": [
      "be accountable for something"
    ],
    "grammarRole": "adjective"
  },
  {
    "id": "vocab:01773",
    "meaning_ja": "somethingを配布する",
    "canonical": "distribute something",
    "paraphrases": [
      "hand something out"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01786",
    "meaning_ja": "somethingをsomething elseに取り付ける",
    "canonical": "attach something to something else",
    "paraphrases": [
      "put something on something else"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01948",
    "meaning_ja": "someoneに借りがある",
    "canonical": "owe someone",
    "paraphrases": [
      "be indebted to someone"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01977",
    "meaning_ja": "somethingを邪魔する",
    "canonical": "disturb something",
    "paraphrases": [
      "bother something",
      "interrupt something",
      "interfere with something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:01979",
    "meaning_ja": "somethingを粘り強く続ける",
    "canonical": "persist in doing something",
    "paraphrases": [
      "persevere in doing something",
      "keep at something",
      "stick with something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:02138",
    "meaning_ja": "somethingに従う",
    "canonical": "obey something",
    "paraphrases": [
      "follow something",
      "comply with something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:02158",
    "meaning_ja": "somethingに抗議する",
    "canonical": "protest something",
    "paraphrases": [
      "object to something",
      "demonstrate against something"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:02362",
    "meaning_ja": "someoneに制裁を科す",
    "canonical": "impose sanctions on someone",
    "paraphrases": [
      "sanction someone"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:02376",
    "meaning_ja": "somewhereへ向かっている",
    "canonical": "be bound for somewhere",
    "paraphrases": [
      "be headed for somewhere",
      "be on one's way to somewhere"
    ],
    "grammarRole": "adjective"
  },
  {
    "id": "vocab:02408",
    "meaning_ja": "somethingについて話し合う",
    "canonical": "discuss something",
    "paraphrases": [
      "talk about something",
      "talk something over"
    ],
    "grammarRole": "verb"
  },
  {
    "id": "vocab:02456",
    "meaning_ja": "〜であるにもかかわらず",
    "canonical": "even though",
    "paraphrases": [
      "although",
      "though"
    ],
    "grammarRole": "conjunction"
  },
  {
    "id": "vocab:02417",
    "meaning_ja": "someoneを信頼する",
    "canonical": "trust someone",
    "paraphrases": [
      "have confidence in someone",
      "rely on someone"
    ],
    "grammarRole": "verb"
  }
];
const byId=new Map(db.entries.map(entry=>[entry.id,entry]));
const curatedById=new Map(paraphraseAudit.curated_paraphrases.map(row=>[row.entry_id,row.paraphrases]));
const confirmedById=new Map(confirmed.map(row=>[row.id,row]));
const materializationById=new Map(materialization.entries.map(row=>[row.id,row]));
const candidatesById=new Map(candidates.map(row=>[row.id,row]));

function slotSignature(text,id,field){
  let surface=String(text||'');
  // In this fixed idiom, “something to do” is the relational phrase; the learner-variable roles are its subject and “with” complement.
  if(id==='vocab:00328'&&field==='canonical') surface=surface.replace(/\bhas something to do with\b/i,'has to do with');
  return [...surface.matchAll(/\bsomething else\b|\bsomeone\b|\bsomewhere\b|\bsomething\b/gi)]
    .map(match=>match[0].toLowerCase()).sort();
}

test('all 56 confirmed paraphrase remediations are materialized exactly and grammarRole is preserved',()=>{
  assert.equal(expected.length,56);
  const ids=expected.map(row=>row.id);
  assert.equal(new Set(ids).size,56);
  assert.equal(db.entries.length,2478);
  assert.equal(byId.size,2478);
  assert.equal(ruleManifest.population,2478);
  assert.equal(ruleManifest.scanned,2478);
  assert.equal(ruleManifest.candidate_count,137);
  assert.equal(ruleManifest.status_counts.CONFIRMED,56);
  assert.equal(ruleManifest.status_counts.REVIEW,0);
  assert.equal(ruleManifest.status_counts.FALSE_POSITIVE,81);
  assert.equal(ruleManifest.unclassified_count,0);
  assert.equal(review.length,0);
  assert.deepEqual(materialization.accounting,{APPLY:56,ALREADY_RESOLVED:0,BLOCKED:0,total:56});
  assert.deepEqual([...materializationById.keys()].sort(),[...confirmedById.keys()].sort());
  for(const row of expected){
    const entry=byId.get(row.id);
    const authority=confirmedById.get(row.id);
    const ledger=materializationById.get(row.id);
    const later=nuanceById.get(row.id);
    const final=later?.after||row;
    assert.ok(entry,`${row.id} exists`);
    assert.equal(authority?.status,'CONFIRMED',`${row.id} confirmed authority`);
    assert.equal(ledger?.status,'APPLY',`${row.id} accounting`);
    assert.deepEqual(ledger.before,{meaning_ja:authority.prompt_ja,canonical:authority.target,paraphrases:authority.paraphrases},`${row.id} audited before-state`);
    assert.deepEqual(ledger.after,{meaning_ja:row.meaning_ja,canonical:row.canonical,paraphrases:row.paraphrases},`${row.id} materialized after-state`);
    assert.equal(entry.meaning_ja,final.meaning_ja,`${row.id} prompt after ordered materialization layers`);
    assert.equal(entry.canonical,final.canonical,`${row.id} canonical`);
    assert.deepEqual(entry.paraphrases??[],final.paraphrases??[],`${row.id} paraphrases after ordered materialization layers`);
    assert.deepEqual(curatedById.get(row.id),final.paraphrases?.length?final.paraphrases:undefined,`${row.id} current curated-audit mirror`);
    assert.equal(entry.grammarRole,row.grammarRole,`${row.id} grammarRole remains authoritative`);
  }
});

test('all 81 FALSE_POSITIVE entries and the zero-REVIEW classification remain unchanged',()=>{
  assert.equal(falsePositive.length,81);
  assert.equal(falsePositive.every(row=>row.status==='FALSE_POSITIVE'),true);
  for(const row of falsePositive){
    const candidate=candidatesById.get(row.id);
    const entry=byId.get(row.id);
    const later=nuanceById.get(row.id);
    const final=later?.after;
    assert.ok(candidate&&entry,`${row.id} exists in audit and production`);
    assert.equal(entry.meaning_ja,final?.meaning_ja??candidate.prompt_ja,`${row.id} prompt follows any later approved layer`);
    assert.equal(entry.canonical,final?.canonical??candidate.target,`${row.id} canonical`);
    assert.deepEqual(entry.paraphrases??[],final?.paraphrases??candidate.paraphrases??[],`${row.id} paraphrases follow any later approved layer`);
  }
});

test('every confirmed answer surface uses the prompt’s explicit placeholder roles',()=>{
  for(const row of expected){
    const promptBranches=String(row.meaning_ja).split(/[\/／]/).map(value=>value.trim()).filter(Boolean);
    const promptSignatures=promptBranches.map(value=>slotSignature(value,row.id,'prompt'));
    for(const signature of promptSignatures.slice(1)) assert.deepEqual(signature,promptSignatures[0],`${row.id} prompt alternatives carry the same roles`);
    const surfaces=[['canonical',row.canonical],...row.paraphrases.map((value,index)=>[`paraphrase ${index+1}`,value])];
    for(const [field,value] of surfaces) assert.deepEqual(slotSignature(value,row.id,field),promptSignatures[0],`${row.id} ${field}: ${value}`);
  }
});

test('vocab:00121 keeps the noun-complement frame and excludes clause-taking conjunctions',()=>{
  const entry=byId.get('vocab:00121');
  assert.equal(entry.meaning_ja,'somethingにもかかわらず');
  assert.equal(entry.canonical,'despite something');
  assert.deepEqual(entry.paraphrases,['in spite of something']);
});

test('vocab:00328 keeps the same subject and related-target roles on every surface',()=>{
  const entry=byId.get('vocab:00328');
  const roles=['something','something else'];
  assert.deepEqual(slotSignature(entry.meaning_ja,entry.id,'prompt'),roles);
  assert.deepEqual(slotSignature(entry.canonical,entry.id,'canonical'),roles);
  for(const surface of entry.paraphrases) assert.deepEqual(slotSignature(surface,entry.id,'paraphrase'),roles);
  assert.equal(entry.canonical,'something has something to do with something else');
  assert.deepEqual(entry.paraphrases,['something is related to something else']);
});

test('vocab:02393 is a FALSE_POSITIVE under its upstream multi-sense authority and needs no materialization',()=>{
  const id='vocab:02393';
  const candidate=candidatesById.get(id);
  const falsePositiveEntry=falsePositive.find(row=>row.id===id);
  const entry=byId.get(id);
  const source=items.find(value=>value.id==='E0508');
  assert.equal(confirmedById.has(id),false);
  assert.equal(materializationById.has(id),false);
  assert.equal(candidate.status,'FALSE_POSITIVE');
  assert.equal(falsePositiveEntry.status,'FALSE_POSITIVE');
  assert.match(candidate.problem,/intentionally multi-sense card/);
  assert.match(candidate.recommended_direction,/do not narrow the canonical/);
  assert.match(source.en,/no place he felt he belonged/);
  assert.match(source.ja,/受け入れられる場所/);
  assert.equal(candidate.source_example.contextual_meaning_ja,'その場所に属する／なじめる');
  assert.equal(entry.meaning_ja,'属する／（人など）のものである');
  assert.equal(entry.canonical,'belong');
  assert.deepEqual(entry.paraphrases,["be someone's"]);
  assert.deepEqual(curatedById.get(id),["be someone's"]);
});



test('vocab:02454 remains FALSE_POSITIVE in the older audit and follows the later nuance authority',()=>{
  const id='vocab:02454';
  const candidate=candidatesById.get(id);
  const falsePositiveEntry=falsePositive.find(row=>row.id===id);
  const entry=byId.get(id);
  const source=items.find(value=>value.id==='E0538');
  assert.equal(confirmedById.has(id),false);
  assert.equal(materializationById.has(id),false);
  assert.equal(candidate.status,'FALSE_POSITIVE');
  assert.equal(falsePositiveEntry.status,'FALSE_POSITIVE');
  assert.match(candidate.problem,/intentional.*multi-construction authority/);
  assert.match(candidate.problem,/subject \+ past/);
  assert.match(candidate.recommended_direction,/Do not narrow the canonical/);
  assert.match(source.en,/Isn't it about time you settled down/);
  assert.match(source.en,/settled down/);
  const later=nuanceById.get(id);
  assert.ok(later,`${id} is covered by the later single-entry authority`);
  assert.equal(candidate.prompt_ja,'もう〜してよい頃だ／いい加減〜すべきだ');
  assert.equal(entry.meaning_ja,later.after.meaning_ja);
  assert.equal(entry.canonical,"it's about time");
  assert.deepEqual(entry.paraphrases??[],later.after.paraphrases);
  assert.deepEqual(curatedById.get(id),entry.paraphrases);
});

test('all-mode collapses the six confirmed cross-kind cards sharing a source and canonical',()=>{
  const pairs=[
    ['vocab:00863','vocab:01400'],
    ['vocab:00933','vocab:00409'],
    ['vocab:00988','vocab:02231'],
    ['vocab:01762','vocab:00363'],
    ['vocab:01786','vocab:01821'],
    ['vocab:01979','vocab:00474'],
  ];
  for(const [wordId,expressionId] of pairs){
    const wordEntry=byId.get(wordId),expressionEntry=byId.get(expressionId);
    assert.ok(wordEntry&&expressionEntry,`${wordId}/${expressionId} exist`);
    assert.equal(wordEntry.kind,'word');
    assert.equal(expressionEntry.kind,'expression');
    assert.equal(wordEntry.canonical,expressionEntry.canonical,`${wordId}/${expressionId} canonical`);
    const sharedItemIds=wordEntry.occurrences.map(value=>String(value.item_id)).filter(id=>expressionEntry.occurrences.some(value=>String(value.item_id)===id));
    assert.ok(sharedItemIds.length>0,`${wordId}/${expressionId} share a source item`);
    const active=entry=>({...entry,activeOccurrence:{item:{id:sharedItemIds[0]},occurrence:entry.occurrences.find(value=>String(value.item_id)===sharedItemIds[0])}});
    const merged=collapseDuplicateVocabularyCards([active(expressionEntry),active(wordEntry)]);
    assert.deepEqual(merged.map(value=>value.id),[wordId],`${wordId}/${expressionId} all-mode duplicate`);
    assert.equal(merged[0].meaning_ja,wordEntry.meaning_ja,`${wordId} remains the authoritative prompt`);
    assert.deepEqual(merged[0].paraphrases,wordEntry.paraphrases,`${wordId} keeps the confirmed paraphrases`);
    assert.deepEqual(collapseDuplicateVocabularyCards([active(wordEntry)]).map(value=>value.id),[wordId],`${wordId} remains available in the word filter`);
    assert.deepEqual(collapseDuplicateVocabularyCards([active(expressionEntry)]).map(value=>value.id),[expressionId],`${expressionId} remains available in the expression filter`);
    const allMode=buildVocabularySession([active(expressionEntry),active(wordEntry)],{}, {kind:'all',size:12,now:1_800_000_000_000});
    assert.deepEqual(allMode.entries.map(value=>value.id),[wordId],`${wordId}/${expressionId} yields one all-mode SRS card`);
    assert.deepEqual(buildVocabularySession([active(expressionEntry),active(wordEntry)],{}, {kind:'word',size:12,now:1_800_000_000_000}).entries.map(value=>value.id),[wordId],`${wordId} remains in word sessions`);
    assert.deepEqual(buildVocabularySession([active(expressionEntry),active(wordEntry)],{}, {kind:'expression',size:12,now:1_800_000_000_000}).entries.map(value=>value.id),[expressionId],`${expressionId} remains in expression sessions`);
    const now=1_800_000_000_000;
    const expressionDue={[expressionId]:{last:2,best:2,updatedAt:now-5000,review:{nextDueAt:now-1}}};
    assert.deepEqual(collapseDuplicateVocabularyCards([active(wordEntry),active(expressionEntry)],expressionDue,now).map(value=>value.id),[expressionId],`${expressionId} remains the representative when its SRS review is due`);
    const duePlan=buildVocabularySession([active(wordEntry),active(expressionEntry)],expressionDue,{kind:'all',size:12,now});
    assert.deepEqual(duePlan.entries.map(value=>value.id),[expressionId],`${expressionId} due state is selected in the all-mode deck`);
    assert.equal(duePlan.due,1);
    assert.equal(vocabularyStats([active(wordEntry),active(expressionEntry)],expressionDue,now).due,1,`${expressionId} due state remains visible in all-mode counts`);
  }
});
