import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyVocabularySpeechAnswer,isTargetSpeechProduction} from '../scripts/speech/vocabularySpeechEvidence.js';
import {classifyVocabularyAnswer} from '../scripts/app/vocabularyLearningCore.js';
import {safeSpeechTokens} from '../scripts/speech/safeSpeechNormalization.js';
import {findSpeechSurfaceMatch} from '../scripts/speech/speechAlignment.js';
import {VOCABULARY_CHUNK_RESCUE_AUTHORITY,VOCABULARY_CHUNK_RESCUE_AUTHORITY_ENTRIES,vocabularyChunkRescueChunks} from '../scripts/speech/vocabularyChunkRescueAuthority.js';
const productionEntriesById=new Map(JSON.parse(readFileSync(new URL('../data/vocabulary-v3.json',import.meta.url),'utf8')).entries.map(value=>[value.id,value]));
const currentProductionEntry=id=>productionEntriesById.get(id);
const segment=(values,index=0)=>({segmentIndex:index,primaryTranscript:values[0],isFinal:true,alternatives:values.map((transcript,asrRank)=>({transcript,asrRank,confidence:0}))});
const entry=(canonical,extra={})=>({canonical,...extra});
const grade=(canonical,transcript,options={})=>classifyVocabularySpeechAnswer({entry:entry(canonical),transcript,...options});

test('strict TARGET token sequence anywhere in primary utterance is accepted and raw evidence is retained',()=>{
  const target='yield to something';
  const accepted=['yield to something','please yield to something','yield to something please','I mean yield to something please','something yield to something again','not yield to something','I refuse to yield to something','yield something yield to something'];
  for(const spoken of accepted){
    const result=grade(target,spoken);
    assert.equal(result.type,'target',spoken);
    assert.equal(result.targetRescued,false,spoken);
    assert.equal(result.primaryTranscript,spoken,spoken);
    assert.equal(result.matchedText,target,spoken);
    assert.equal(result.recognitionAuthority,'exact',spoken);
  }
  for(const spoken of ['not yield to something',"I won't yield to something",'I refuse to yield to something']){
    assert.equal(grade(target,spoken).type,'target','meaning and negation are deliberately not evaluated: '+spoken);
  }
  assert.equal(classifyVocabularyAnswer({entry:entry(target),transcript:'I mean yield to something please'}).type,'miss','strict lexical authority remains unchanged');
});

test('TARGET sequence must be contiguous; words inside it cannot be skipped',()=>{
  for(const spoken of ['yield um to something','yield please to something','yield to definitely something','years to something','yield something','yield to do something','yielded to something']){
    assert.equal(grade('yield to something',spoken).type,'miss',spoken);
    assert.equal(isTargetSpeechProduction(spoken,'yield to something'),false,spoken);
  }
});

test('matching uses normalized word boundaries rather than string substrings',()=>{
  for(const [target,spoken] of [['yield','yielded'],['yield','yields'],['yell','yelling'],['be in','being']]){
    assert.equal(grade(target,spoken).type,'miss',spoken+' must not contain token sequence '+target);
  }
  assert.equal(grade('yield to something','well, yield to something, please').type,'target');
  assert.equal(isTargetSpeechProduction('WELL, yield to something, please.','yield to something'),true);
});

test('Vocabulary accepts the optional exact leading speech carrier while retaining raw TARGET evidence',()=>{
  const dye={id:'vocab:01314',canonical:'dye'};
  const direct=classifyVocabularySpeechAnswer({entry:dye,transcript:'dye'});
  assert.equal(direct.type,'target');
  assert.equal(direct.rawTranscript,'dye');

  const carried=classifyVocabularySpeechAnswer({entry:dye,transcript:'my answer is dye'});
  assert.equal(carried.type,'target');
  assert.equal(carried.matchedExpected,'dye');
  assert.equal(carried.primaryTranscript,'my answer is dye');
  assert.equal(carried.rawTranscript,'my answer is dye');
  assert.equal(carried.displayTranscript,'my answer is dye');
  assert.equal(carried.speechMatch.rawTranscript,'my answer is dye');

  const homophone=classifyVocabularySpeechAnswer({
    entry:dye,
    transcript:'My answer is, die.',
    recognitionSegments:[segmentFactory(['My answer is, die.'])],
  });
  assert.equal(homophone.type,'target');
  assert.equal(homophone.recognitionAuthority,'explicit-equivalence');
  assert.equal(homophone.speechMatch.ruleId,'dye-die');
  assert.equal(homophone.speechMatch.ruleKind,'homophone');
  assert.equal(homophone.rawTranscript,'My answer is, die.');
  assert.equal(homophone.displayTranscript,'My answer is, die.');

  assert.equal(classifyVocabularySpeechAnswer({entry:dye,transcript:'my answer is'}).type,'miss');
  assert.equal(classifyVocabularySpeechAnswer({entry:dye,transcript:'my answer is unrelated'}).type,'miss');
  assert.equal(classifyVocabularySpeechAnswer({entry:dye,transcript:'my answer is dye',correction:true}).type,'target');

  const carrierlessEquivalent=classifyVocabularySpeechAnswer({
    entry:dye,
    transcript:'die',
    recognitionSegments:[segmentFactory(['die'])],
  });
  assert.equal(carrierlessEquivalent.type,'target');
  assert.equal(carrierlessEquivalent.speechMatch.ruleId,'dye-die');
});

test('exact leading carrier enables only a complete accepted paraphrase and is removed once',()=>{
  const e=entry('yield to something',{paraphrases:['give in to something']});
  const raw='My answer is, give in to something.';
  const result=classifyVocabularySpeechAnswer({
    entry:e,
    transcript:raw,
    recognitionSegments:[segmentFactory([raw])],
  });
  assert.equal(result.type,'paraphrase');
  assert.equal(result.matchedText,'give in to something');
  assert.equal(result.recognitionAuthority,'exact');
  assert.equal(result.primaryTranscript,raw);
  assert.equal(result.rawTranscript,raw);
  assert.equal(result.displayTranscript,raw);
  assert.equal(result.speechMatch.rawTranscript,raw);
  assert.deepEqual(result.speechCarrier,{prefix:'my answer is',gradingTranscript:', give in to something.'});

  for(const transcript of [
    'my answer is unrelated give in to something',
    'my answer is give in to something please',
    'my answer is my answer is give in to something',
  ]){
    assert.equal(classifyVocabularySpeechAnswer({entry:e,transcript}).type,'miss',transcript);
  }
  assert.equal(classifyVocabularySpeechAnswer({entry:e,transcript:'give in to something',correction:true}).type,'miss');
  assert.equal(classifyVocabularySpeechAnswer({entry:e,transcript:'my answer is give in to something',correction:true}).type,'miss');
});

test('carrier-bearing lower N-best TARGET candidates retain independent raw provenance and rank',()=>{
  const dye={id:'vocab:01314',canonical:'dye'};
  for(const candidate of ['my answer is dye','my answer is die']){
    const primary='unrelated words';
    const result=classifyVocabularySpeechAnswer({
      entry:dye,
      transcript:primary,
      recognitionSegments:[segmentFactory([primary,candidate])],
    });
    assert.equal(result.type,'target',candidate);
    assert.equal(result.targetRescued,true,candidate);
    assert.equal(result.primaryTranscript,primary,candidate);
    assert.equal(result.rawTranscript,candidate,candidate);
    assert.equal(result.speechMatch.rawTranscript,candidate,candidate);
    assert.equal(result.recognitionSegmentIndex,0,candidate);
    assert.equal(result.asrRank,1,candidate);
  }
  const explicit=classifyVocabularySpeechAnswer({
    entry:dye,
    transcript:'unrelated words',
    recognitionSegments:[segmentFactory(['unrelated words','my answer is die'])],
  });
  assert.equal(explicit.speechMatch.ruleId,'dye-die');
  assert.equal(explicit.speechMatch.ruleKind,'homophone');
});

test('canonical, answers, and active source surfaces are containment authorities; paraphrases are not',()=>{
  const withAnswer=entry('yield to something',{answers:['yield to pressure'],paraphrases:['give in to pressure']});
  assert.equal(classifyVocabularySpeechAnswer({entry:withAnswer,transcript:'please yield to pressure again'}).type,'target');
  const source='He will yield to pressure soon.';
  const start=source.indexOf('yield to pressure');
  const activeOccurrence={item:{en:source},occurrence:{start,end:start+'yield to pressure'.length}};
  assert.equal(classifyVocabularySpeechAnswer({entry:entry('yield to something'),activeOccurrence,transcript:'please yield to pressure again'}).type,'target');
  assert.equal(classifyVocabularySpeechAnswer({entry:withAnswer,transcript:'I would give in to pressure'}).type,'miss');
  assert.equal(classifyVocabularySpeechAnswer({entry:withAnswer,transcript:'I would give in to pressure',recognitionSegments:[segment(['wrong','please give in to pressure again'])]}).type,'miss');
});

test('lower N-best rank 20 rescues an independent contained TARGET candidate and preserves primary rank-one evidence',()=>{
  const alternatives=Array.from({length:20},(_,i)=>i===0?'years to something':i===19?'please yield to something again':'unrelated speech');
  const recognitionSegments=[segment(alternatives,0)];
  const result=classifyVocabularySpeechAnswer({entry:entry('yield to something'),transcript:alternatives[0],recognitionSegments});
  assert.equal(result.type,'target');
  assert.equal(result.targetRescued,true);
  assert.equal(result.recognitionAuthority,'nbest-exact');
  assert.equal(result.asrRank,19);
  assert.equal(result.primaryTranscript,alternatives[0]);
});

test('lower N-best paraphrases, phonetic near-matches, and incomplete TARGET fragments are not rescued',()=>{
  const e=entry('yield to something',{paraphrases:['give in to something']});
  for(const lower of ['give in to something','years to something','yield to','something','yield something','yield to do something']){
    const result=classifyVocabularySpeechAnswer({entry:e,transcript:'wrong',recognitionSegments:[segment(['wrong',lower])]});
    assert.equal(result.type,'miss',lower);
  }
});

test('lower candidates stay independent across segments; primary accumulation remains allowed',()=>{
  const e=entry('yield to something');
  const splitOnly=[segment(['wrong','yield to'],0),segment(['wrong','something'],1)];
  assert.equal(classifyVocabularySpeechAnswer({entry:e,transcript:'wrong wrong',recognitionSegments:splitOnly}).type,'miss');
  const oneCandidateAlongsideOtherWords=[segment(['not','years to something'],0),segment(['other','yield to something'],1)];
  const rescued=classifyVocabularySpeechAnswer({entry:e,transcript:'not other',recognitionSegments:oneCandidateAlongsideOtherWords});
  assert.equal(rescued.type,'target');
  assert.equal(rescued.recognitionAuthority,'nbest-exact');
  assert.equal(rescued.asrRank,1);
  assert.equal(rescued.recognitionSegmentIndex,1);
  const primary=classifyVocabularySpeechAnswer({entry:e,transcript:'yield to something',recognitionSegments:[segment(['yield to'],0),segment(['something'],1)]});
  assert.equal(primary.type,'target');
  assert.equal(primary.recognitionAuthority,'exact');
  assert.equal(primary.recognitionSegmentIndex,null,'a TARGET joined across two primary segments has no single supporting segment');
});

test('correction accepts contained strict TARGET while preserving correction and paraphrase rules',()=>{
  const e=entry('come across someone',{paraphrases:['run into someone']});
  const target=classifyVocabularySpeechAnswer({entry:e,transcript:'okay come across someone again',correction:true});
  assert.equal(target.type,'target');assert.equal(target.targetRescued,false);
  assert.equal(target.recognitionAuthority,'exact');
  assert.equal(target.targetMatchKind,'contained-target');
  assert.equal(classifyVocabularySpeechAnswer({entry:e,transcript:'run into someone',correction:true}).type,'miss');
  assert.equal(classifyVocabularySpeechAnswer({entry:e,transcript:'run into someone'}).type,'paraphrase');
});

test('prose/pros is TARGET with rule provenance while raw provider evidence stays pros',()=>{
  const segment=segmentFactory(['pros']);
  const result=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:01089',canonical:'prose'},
    transcript:'pros',
    recognitionSegments:[segment],
  });
  assert.equal(result.type,'target');
  assert.equal(result.matchedAuthority,'canonical');
  assert.equal(result.recognitionAuthority,'explicit-equivalence');
  assert.equal(result.matchedExpected,'prose');
  assert.equal(result.observed,'pros');
  assert.equal(result.rawTranscript,'pros');
  assert.equal(result.displayTranscript,'prose');
  assert.equal(result.speechMatch.ruleId,'prose-pros');
  assert.equal(result.speechMatch.ruleKind,'homophone');
  assert.equal(result.recognitionSegmentIndex,0);
  assert.equal(result.asrRank,0);
  assert.equal(segment.alternatives[0].transcript,'pros');
});

test('vocab:01314 dye accepts the die homophone while preserving raw display evidence',()=>{
  const result=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:01314',canonical:'dye'},
    transcript:'die',
    recognitionSegments:[segmentFactory(['die'])],
  });
  assert.equal(result.type,'target');
  assert.equal(result.recognitionAuthority,'explicit-equivalence');
  assert.equal(result.matchedExpected,'dye');
  assert.equal(result.observed,'die');
  assert.equal(result.rawTranscript,'die');
  assert.equal(result.displayTranscript,'die');
  assert.equal(result.speechMatch.ruleId,'dye-die');
  assert.equal(result.speechMatch.ruleKind,'homophone');
});

test('registered ASR homophone and segmentation equivalents rescue TARGET in both directions',()=>{
  const cases=[
    ['altogether','all together','altogether-all-together','segmentation-equivalence'],
    ['oh','owe','oh-owe','homophone'],
    ['sent','scent','sent-scent','homophone'],
  ];
  for(const [expected,recognized,ruleId,ruleKind] of cases){
    const forward=classifyVocabularySpeechAnswer({entry:{canonical:expected},transcript:recognized,recognitionSegments:[segmentFactory([recognized])]});
    assert.equal(forward.type,'target',expected+' / '+recognized);
    assert.equal(forward.recognitionAuthority,'explicit-equivalence');
    assert.equal(forward.matchedExpected,expected);
    assert.equal(forward.observed,recognized);
    assert.equal(forward.rawTranscript,recognized);
    assert.equal(forward.speechMatch.ruleId,ruleId);
    assert.equal(forward.speechMatch.ruleKind,ruleKind);

    const reverse=classifyVocabularySpeechAnswer({entry:{canonical:recognized},transcript:expected,recognitionSegments:[segmentFactory([expected])]});
    assert.equal(reverse.type,'target',recognized+' / '+expected);
    assert.equal(reverse.recognitionAuthority,'explicit-equivalence');
    assert.equal(reverse.matchedExpected,recognized);
    assert.equal(reverse.observed,expected);
    assert.equal(reverse.rawTranscript,expected);
    assert.equal(reverse.speechMatch.ruleKind,ruleKind);
  }
});

test('lower N-best explicit TARGET equivalence records selected raw segment/rank without paraphrase rescue',()=>{
  const recognitionSegments=[segmentFactory(['wrong','pros'])];
  const result=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:01089',canonical:'prose'},
    transcript:'wrong',
    recognitionSegments,
  });
  assert.equal(result.type,'target');
  assert.equal(result.targetRescued,true);
  assert.equal(result.recognitionAuthority,'explicit-equivalence');
  assert.equal(result.primaryTranscript,'wrong');
  assert.equal(result.rawTranscript,'pros');
  assert.equal(result.displayTranscript,'prose');
  assert.equal(result.asrRank,1);
  assert.equal(result.recognitionSegmentIndex,0);
  assert.equal(recognitionSegments[0].alternatives[1].transcript,'pros');
});

test('curated chunk authority has exactly the approved 18 canonical two-chunk surfaces',()=>{
  const expectedIds=[
    'vocab:00059','vocab:00139','vocab:00185','vocab:00225','vocab:00244','vocab:00300',
    'vocab:00328','vocab:00370','vocab:00427','vocab:00528','vocab:00661','vocab:00673',
    'vocab:01631','vocab:01671','vocab:02060','vocab:02202','vocab:02384','vocab:02452',
  ];
  const nonTargetIds=[
    'vocab:00013','vocab:00071','vocab:00100','vocab:00151','vocab:00237','vocab:00250',
    'vocab:00341','vocab:00418','vocab:00420','vocab:00469','vocab:00478','vocab:00491',
    'vocab:00546','vocab:00578','vocab:00622','vocab:00644','vocab:00696','vocab:01153',
    'vocab:01514','vocab:01654','vocab:01668','vocab:01816','vocab:01912','vocab:02445',
  ];
  const ids=VOCABULARY_CHUNK_RESCUE_AUTHORITY_ENTRIES.map(([id])=>id);
  assert.equal(ids.length,18);
  assert.equal(new Set(ids).size,18);
  assert.deepEqual(ids.sort(),expectedIds.sort());

  const entries=JSON.parse(readFileSync(new URL('../data/vocabulary-v3.json',import.meta.url),'utf8')).entries;
  const byId=new Map(entries.map(value=>[value.id,value]));
  for(const id of expectedIds){
    const chunks=VOCABULARY_CHUNK_RESCUE_AUTHORITY[id];
    assert.equal(chunks.length,2,id);
    assert.ok(chunks.every(chunk=>typeof chunk==='string'&&chunk.trim()),id);
    const canonicalTokens=safeSpeechTokens(byId.get(id)?.canonical).map(token=>token.value);
    const chunkTokens=safeSpeechTokens(chunks.join(' ')).map(token=>token.value);
    assert.ok(byId.has(id),id+' exists in production vocabulary');
    assert.deepEqual(chunkTokens,canonicalTokens,id+' chunks reconstruct canonical after safe normalization');
  }
  for(const id of nonTargetIds) assert.equal(Object.hasOwn(VOCABULARY_CHUNK_RESCUE_AUTHORITY,id),false,id);
});

test('vocab:00139 chunk N-best rescue accepts either rank-zero chunk plus one strict lower candidate',()=>{
  const liveEntry=currentProductionEntry('vocab:00139');
  const chunks=vocabularyChunkRescueChunks(liveEntry);
  if(!chunks){
    const stale=VOCABULARY_CHUNK_RESCUE_AUTHORITY['vocab:00139'];
    const stalePrimary=`${stale[0]} unrelated tokens`;
    assert.equal(classifyVocabularySpeechAnswer({entry:liveEntry,transcript:stalePrimary,recognitionSegments:[segmentFactory([stalePrimary,stale[1]])]}).type,'miss');
    return;
  }
  const canonical=liveEntry.canonical;
  const [firstChunk,secondChunk]=chunks;
  const primary=`${firstChunk} unrelated tokens`;
  const result=classifyVocabularySpeechAnswer({
    entry:liveEntry,
    transcript:primary,
    recognitionSegments:[segmentFactory([primary,'unrelated',secondChunk])],
  });
  assert.equal(result.type,'target');
  assert.equal(result.targetRescued,true);
  assert.equal(result.recognitionAuthority,'nbest-chunk-exact');
  assert.equal(result.asrRank,2);
  assert.equal(result.recognitionSegmentIndex,0);
  assert.equal(result.matchedExpected,canonical);
  assert.equal(result.primaryTranscript,primary);
  assert.equal(result.displayTranscript,primary);
  assert.equal(result.rawTranscript,secondChunk);
  assert.equal(result.rescuedChunk.expected,secondChunk);
  assert.equal(result.supportingPrimaryChunk.expected,firstChunk);
  assert.equal(result.chunkRescue.authority,'nbest-chunk-exact');

  const reversed=classifyVocabularySpeechAnswer({
    entry:liveEntry,
    transcript:`please ${secondChunk}, thanks`,
    recognitionSegments:[segmentFactory([`please ${secondChunk}, thanks`,firstChunk])],
  });
  assert.equal(reversed.type,'target');
  assert.equal(reversed.rescuedChunk.expected,firstChunk);
  assert.equal(reversed.supportingPrimaryChunk.expected,secondChunk);
});

test('vocab:00328 chunks reconstruct the current canonical and rescue either strict split direction',()=>{
  const canonical='something has something to do with something else';
  const chunks=VOCABULARY_CHUNK_RESCUE_AUTHORITY['vocab:00328'];
  assert.deepEqual(chunks,['something has something to do','with something else']);
  assert.deepEqual(
    safeSpeechTokens(chunks.join(' ')).map(token=>token.value),
    safeSpeechTokens(canonical).map(token=>token.value),
  );
  const placeholders=text=>text.match(/\b(?:something else|something|someone)\b/g)||[];
  assert.deepEqual(placeholders(chunks.join(' ')),placeholders(canonical));
  assert.equal(chunks.includes('have something to do'),false);
  assert.equal(chunks.join(' ').includes('is related to'),false);

  const positive=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00328',canonical},
    transcript:chunks[0],
    recognitionSegments:[segmentFactory([chunks[0],chunks[1]])],
  });
  assert.equal(positive.type,'target');
  assert.equal(positive.recognitionAuthority,'nbest-chunk-exact');
  assert.equal(positive.rescuedChunk.expected,chunks[1]);
  assert.equal(positive.supportingPrimaryChunk.expected,chunks[0]);

  const reversed=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00328',canonical},
    transcript:chunks[1],
    recognitionSegments:[segmentFactory([chunks[1],chunks[0]])],
  });
  assert.equal(reversed.type,'target');
  assert.equal(reversed.recognitionAuthority,'nbest-chunk-exact');
  assert.equal(reversed.rescuedChunk.expected,chunks[0]);
  assert.equal(reversed.supportingPrimaryChunk.expected,chunks[1]);
});

test('vocab:00328 rejects stale chunks, paraphrase mixing, and fuzzy chunk candidates',()=>{
  const canonical='something has something to do with something else';
  const oldFirst='have something to do';
  const second='with something else';
  const stale=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00328',canonical},
    transcript:oldFirst,
    recognitionSegments:[segmentFactory([oldFirst,second])],
  });
  assert.equal(stale.type,'miss');
  assert.equal(stale.chunkRescue,undefined);

  const paraphrase='something is related to something else';
  const paraphrased=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00328',canonical,paraphrases:[paraphrase]},
    transcript:paraphrase,
  });
  assert.equal(paraphrased.type,'paraphrase');
  assert.equal(paraphrased.chunkRescue,undefined);

  const mixed=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00328',canonical,paraphrases:[paraphrase]},
    transcript:'something has something to do',
    recognitionSegments:[segmentFactory(['something has something to do',paraphrase])],
  });
  assert.equal(mixed.type,'miss');

  const fuzzy=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00328',canonical},
    transcript:'something has something to do',
    recognitionSegments:[segmentFactory(['something has something to do','with something els'])],
  });
  assert.equal(fuzzy.type,'miss');
});

test('chunk rescue retains explicit-equivalence provenance on either supporting chunk',()=>{
  const canonical='not so much by something as by something else';
  const lowerEquivalent=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00225',canonical},
    transcript:'not so much by something',
    recognitionSegments:[segmentFactory(['not so much by something','as buy something else'])],
  });
  assert.equal(lowerEquivalent.type,'target');
  assert.equal(lowerEquivalent.recognitionAuthority,'nbest-chunk-exact');
  assert.equal(lowerEquivalent.rescuedChunk.authority,'explicit-equivalence');
  assert.equal(lowerEquivalent.rescuedChunk.ruleId,'by-buy');
  assert.equal(lowerEquivalent.speechMatch.authority,'explicit-equivalence');
  assert.equal(lowerEquivalent.speechMatch.ruleKind,'homophone');
  assert.equal(lowerEquivalent.displayTranscript,'not so much by something');

  const primaryEquivalent=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00225',canonical},
    transcript:'not so much buy something',
    recognitionSegments:[segmentFactory(['not so much buy something','as by something else'])],
  });
  assert.equal(primaryEquivalent.type,'target');
  assert.equal(primaryEquivalent.recognitionAuthority,'nbest-chunk-exact');
  assert.equal(primaryEquivalent.supportingPrimaryChunk.authority,'explicit-equivalence');
  assert.equal(primaryEquivalent.supportingPrimaryChunk.ruleId,'by-buy');
});

test('chunk rescue rejects missing, partial, split-candidate, paraphrase, and uncurated evidence',()=>{
  const id='vocab:00139';
  const liveEntry=currentProductionEntry(id);
  const canonical=liveEntry.canonical;
  const chunks=vocabularyChunkRescueChunks(liveEntry);
  if(!chunks){
    const stale=VOCABULARY_CHUNK_RESCUE_AUTHORITY[id];
    const stalePrimary=`${stale[0]} unrelated tokens`;
    assert.equal(classifyVocabularySpeechAnswer({entry:liveEntry,transcript:stalePrimary,recognitionSegments:[segmentFactory([stalePrimary,stale[1]])]}).type,'miss');
    return;
  }
  const [firstChunk,secondChunk]=chunks;
  const primaryWithNoise=`${firstChunk} down unrelated`;
  const secondWords=secondChunk.split(/\s+/u);
  const partialChunk=secondWords.slice(1).join(' ')||'unrelated';
  const cases=[
    ['both primary chunks missing','something entirely unrelated',[segmentFactory(['something entirely unrelated',secondChunk])]],
    ['lower candidate has only a partial chunk',primaryWithNoise,[segmentFactory([primaryWithNoise,partialChunk])]],
    ['chunks only appear in different lower candidates','something entirely unrelated',[segmentFactory(['something entirely unrelated',firstChunk]),segmentFactory(['something else',secondChunk])]],
    ['TARGET chunk cannot be completed by a PARAPHRASE',primaryWithNoise,[segmentFactory([primaryWithNoise,secondChunk])]],
    ['correction cannot combine a primary PARAPHRASE with a lower TARGET chunk',firstChunk,[segmentFactory([firstChunk,secondChunk])]],
  ];
  for(const [label,transcript,recognitionSegments] of cases){
    const paraphrases=label.startsWith('correction')?[firstChunk]:label.includes('PARAPHRASE')?[secondChunk]:liveEntry.paraphrases;
    const result=classifyVocabularySpeechAnswer({entry:{...liveEntry,canonical,paraphrases},transcript,recognitionSegments,correction:label.startsWith('correction')});
    assert.equal(result.type,'miss',label);
  }

  assert.equal(classifyVocabularySpeechAnswer({
    entry:{...liveEntry,canonical:'changed canonical'},
    transcript:primaryWithNoise,
    recognitionSegments:[segmentFactory([primaryWithNoise,secondChunk])],
  }).type,'miss','stale curated chunks fail closed after a canonical change');

  const nonTargetIds=[
    'vocab:00013','vocab:00071','vocab:00100','vocab:00151','vocab:00237','vocab:00250',
    'vocab:00341','vocab:00418','vocab:00420','vocab:00469','vocab:00478','vocab:00491',
    'vocab:00546','vocab:00578','vocab:00622','vocab:00644','vocab:00696','vocab:01153',
    'vocab:01514','vocab:01654','vocab:01668','vocab:01816','vocab:01912','vocab:02445',
  ];
  for(const nonTargetId of nonTargetIds){
    const target=currentProductionEntry(nonTargetId);
    const words=safeSpeechTokens(target.canonical).map(token=>token.value);
    const cut=Math.floor(words.length/2);
    const first=words.slice(0,cut).join(' ');
    const second=words.slice(cut).join(' ');
    const result=classifyVocabularySpeechAnswer({
      entry:{id:nonTargetId,canonical:target.canonical},
      transcript:first,
      recognitionSegments:[segmentFactory([first,second])],
    });
    assert.equal(result.type,'miss',nonTargetId+' stays outside curated chunk authority');
  }
  assert.equal(classifyVocabularySpeechAnswer({
    entry:{canonical},
    transcript:primaryWithNoise,
    recognitionSegments:[segmentFactory([primaryWithNoise,secondChunk])],
  }).type,'miss','an uncurated entry with the same text stays unchanged');
});

test('existing lower full TARGET rescue wins before curated chunk rescue',()=>{
  const liveEntry=currentProductionEntry('vocab:00139');
  const canonical=liveEntry.canonical;
  const primary=`${vocabularyChunkRescueChunks(liveEntry)?.[0]||'unrelated'} down unrelated`;
  const result=classifyVocabularySpeechAnswer({
    entry:liveEntry,
    transcript:primary,
    recognitionSegments:[segmentFactory([primary,'unrelated',canonical])],
  });
  assert.equal(result.type,'target');
  assert.equal(result.recognitionAuthority,'nbest-exact');
  assert.equal(result.asrRank,2);
  assert.equal(result.targetMatchKind,'full-surface');
  assert.equal(result.chunkRescue,undefined);
});

test('curated chunk rescue can use the existing deepest retained strict N-best rank',()=>{
  const liveEntry=currentProductionEntry('vocab:00139');
  const [firstChunk,secondChunk]=vocabularyChunkRescueChunks(liveEntry)||['unrelated','other'];
  const primary=`${firstChunk} down unrelated`;
  const alternatives=Array.from({length:20},(_,index)=>index===0?primary:index===19?secondChunk:`unrelated ${index}`);
  const result=classifyVocabularySpeechAnswer({
    entry:liveEntry,
    transcript:primary,
    recognitionSegments:[segmentFactory(alternatives)],
  });
  assert.equal(result.type,'target');
  assert.equal(result.asrRank,19,'provider rank 20 is retained with zero-based metadata');
  assert.equal(result.recognitionAuthority,'nbest-chunk-exact');
});

test('Vocabulary then/than ASR equivalence is bidirectional without changing the transcript or other modes',()=>{
  const canonical='no sooner had I arrived than the phone rang';
  const primary='no sooner had I arrived then the phone rang';
  const positive=classifyVocabularySpeechAnswer({entry:{id:'vocab:00139',canonical},transcript:primary});
  assert.equal(positive.type,'target');
  assert.equal(positive.recognitionAuthority,'explicit-equivalence');
  assert.equal(positive.speechMatch.ruleId,'than-then');
  assert.equal(positive.speechMatch.ruleKind,'asr-context-collision');
  assert.equal(positive.rawTranscript,primary);
  assert.equal(positive.displayTranscript,primary);
  const reverse=classifyVocabularySpeechAnswer({entry:{canonical:'then'},transcript:'than'});
  assert.equal(reverse.type,'target');
  assert.equal(reverse.speechMatch.ruleId,'then-than');
  assert.equal(classifyVocabularySpeechAnswer({entry:{canonical:'than'},transcript:'then'}).type,'target');
  assert.equal(classifyVocabularySpeechAnswer({entry:{canonical:'than'},transcript:'down'}).type,'miss');
  assert.equal(findSpeechSurfaceMatch('than','then',{context:{mode:'reading'}}),null);
});

test('postwar/post war is explicit TARGET equivalence with raw transcript display',()=>{
  const result=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:01943',canonical:'postwar'},
    transcript:'post war',
  });
  assert.equal(result.type,'target');
  assert.equal(result.recognitionAuthority,'explicit-equivalence');
  assert.equal(result.speechMatch.ruleId,'postwar-post-war');
  assert.equal(result.rawTranscript,'post war');
  assert.equal(result.displayTranscript,'post war');
});

test('legacy phonetic/one-edit examples remain Vocabulary MISS',()=>{
  for(const [canonical,spoken] of [['yell','yeah'],['live','love'],['cat','cut'],['price','prize'],['walk','talk']]){
    assert.equal(classifyVocabularySpeechAnswer({entry:{canonical},transcript:spoken}).type,'miss',`${canonical} / ${spoken}`);
  }
});

function segmentFactory(values,index=0){
  return {segmentIndex:index,primaryTranscript:values[0],isFinal:true,
    alternatives:values.map((transcript,asrRank)=>({transcript,asrRank,confidence:null}))};
}
