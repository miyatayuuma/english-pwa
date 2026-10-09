import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRawTranscriptFinal } from '../scripts/speech/recognition.js';
import { alignSpeech, findSpeechSurfaceMatch } from '../scripts/speech/speechAlignment.js';
import { gradeReadSpeech } from '../scripts/speech/readSpeechGrader.js';
import { applySpeechHighlight } from '../scripts/speech/speechPresentation.js';

function tokenSpan(text) {
  const classes = new Set();
  return {
    textContent: text,
    dataset: { w: text },
    classes,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    },
  };
}

function presentAlignment(reference, observed, surfaces) {
  const alignment = alignSpeech(reference, observed);
  const spans = surfaces.map(tokenSpan);
  applySpeechHighlight(alignment, { querySelectorAll: () => spans }, () => []);
  return { alignment, spans };
}

test('raw provider transcript stitching preserves supplied words and punctuation', () => {
  assert.equal(appendRawTranscriptFinal('', 'I’m ready to pay two dollars.'), 'I’m ready to pay two dollars.');
  assert.equal(appendRawTranscriptFinal('well-known', 'story begins'), 'well-known story begins');
  assert.equal(appendRawTranscriptFinal('turn the faucet', 'the faucet off now'), 'turn the faucet off now');
  assert.equal(appendRawTranscriptFinal('despite', 'despise'), 'despite despise');
});

test('prose/pros is an explicit global homophone with provenance and target-spelling display', () => {
  const result = alignSpeech('prose', 'pros', {
    context: { mode: 'read' }, recognitionSegmentIndex: 0, asrRank: 0,
  });
  assert.equal(result.matchRate, 1);
  assert.equal(result.rawTranscript, 'pros');
  assert.equal(result.displayTranscript, 'prose');
  const match = result.alignment[0];
  assert.equal(match.authority, 'explicit-equivalence');
  assert.equal(match.ruleId, 'prose-pros');
  assert.equal(match.ruleKind, 'homophone');
  assert.equal(match.expected, 'prose');
  assert.equal(match.observed, 'pros');
  assert.equal(match.recognitionSegmentIndex, 0);
  assert.equal(match.asrRank, 0);
});

test('dye/die is a symmetric explicit homophone and preserves the provider spelling',()=>{
  for(const [expected,recognized,ruleId] of [['dye','die','dye-die'],['die','dye','die-dye']]){
    const result=alignSpeech(expected,recognized);
    assert.equal(result.matchRate,1);
    assert.equal(result.rawTranscript,recognized);
    assert.equal(result.displayTranscript,recognized);
    const match=result.alignment.find(event=>event.ruleId===ruleId);
    assert.ok(match);
    assert.equal(match.authority,'explicit-equivalence');
    assert.equal(match.ruleKind,'homophone');
    assert.equal(match.expected,expected);
    assert.equal(match.observed,recognized);
  }
  assert.equal(findSpeechSurfaceMatch('dye','die')?.ruleId,'dye-die');
  assert.equal(findSpeechSurfaceMatch('die','dye')?.ruleId,'die-dye');
});

test('postwar/post war is an explicit segmentation equivalence with raw display and exact-equivalent score', () => {
  const result = alignSpeech('The postwar era.', 'The post war era.');
  assert.equal(result.matchRate, 1);
  assert.equal(result.displayTranscript, 'The post war era.');
  const match = result.alignment.find(event => event.ruleId === 'postwar-post-war');
  assert.ok(match);
  assert.equal(match.expected, 'postwar');
  assert.equal(match.observed, 'post war');
  assert.equal(match.authority, 'explicit-equivalence');
});

test('hyphen-space and reviewed compound boundaries preserve ordered speech and source offsets',()=>{
  const positive=[
    ['postwar','postwar'],['postwar','post-war'],['postwar','post war'],
    ['birthrate','birth-rate'],['birthrate','birth rate'],
    ['makeup','make-up'],['makeup','make up'],['make-up','make up'],
    ['up-to-date','up to date'],['son-in-law','son in law'],
    ['white-collar','white collar'],['round-trip','round trip'],
    ['email','e-mail'],['email','e mail'],['high-tech','hi-tech'],
  ];
  for(const [reference,spoken] of positive){
    const alignment=alignSpeech(reference,spoken);
    assert.equal(gradeReadSpeech(alignment).score,1,`${reference} / ${spoken}`);
    assert.equal(alignment.orderedMatchIntegrity.valid,true,`${reference} / ${spoken}`);
    assert.equal(alignment.rawTranscript,spoken,`${reference} / ${spoken}`);
  }
  const mapped=alignSpeech('The postwar era.','The post-war era.');
  assert.deepEqual(mapped.referenceTokens.map(token=>[token.value,token.start,token.end]),[
    ['the',0,3],['postwar',4,11],['era',12,15],
  ]);
  assert.equal(mapped.alignment.some(event=>event.ruleId==='postwar-post-war'),true);
});

test('compound equivalence does not collapse lexical boundaries, inserted words, substrings, or order',()=>{
  for(const [reference,spoken] of [
    ['insight','in sight'],['resign','re-sign'],['another','an other'],
  ]){
    const alignment=alignSpeech(reference,spoken);
    assert.equal(gradeReadSpeech(alignment).score,0,`${reference} / ${spoken}`);
    assert.equal(findSpeechSurfaceMatch(reference,spoken),null,`${reference} / ${spoken}`);
  }
  for(const spoken of ['post unrelated war','war post','post','post word']){
    assert.equal(findSpeechSurfaceMatch('post war',spoken),null,spoken);
  }
});

test('word order integrity also sees inversions across a registered compound split',()=>{
  const alignment=alignSpeech('Postwar policy has arrived.','Arrived post war policy has.',{context:{mode:'read'}});
  assert.ok(alignment.matchRate>=0.8,'token F1 remains high despite the inverted phrase');
  assert.equal(alignment.orderedMatchIntegrity.valid,false);
  assert.equal(gradeReadSpeech(alignment).score,0);
});

test('Vocabulary-audited local speech rescues are shared in Read and Cloze without dropping the phrase context',()=>{
  const cases=[
    ['I used to live there.','I use to live there.','read','shared-read-td-cluster-before-to-vocab-00648-used-to-use'],
    ['They tend to arrive early.','They ten to arrive early.','cloze','shared-read-td-cluster-before-to-vocab-00502-tend-to-ten'],
    ['No sooner had I arrived than the phone rang.','No sooner had I arrived then the phone rang.','read','than-then'],
  ];
  for(const [reference,spoken,mode,ruleId] of cases){
    const alignment=alignSpeech(reference,spoken,{context:{mode}});
    assert.equal(gradeReadSpeech(alignment).score,1,`${reference} / ${spoken}`);
    assert.equal(alignment.alignment.some(event=>event.ruleId===ruleId),true,ruleId);
  }
  for(const [reference,spoken,mode] of [['used','use','read'],['tend','ten','cloze']]){
    assert.equal(findSpeechSurfaceMatch(reference,spoken,{context:{mode}}),null,`${reference} / ${spoken}`);
  }
  const full=alignSpeech('They used to listen.','They use to listen.',{context:{mode:'read'}});
  assert.equal(full.rawTranscript,'They use to listen.');
  assert.equal(full.displayTranscript,'They use to listen.');
});

test('equivalences work inside sentence alignment and do not rewrite raw transcript evidence', () => {
  const prose = alignSpeech('His prose is clear.', 'His pros is clear.');
  assert.equal(prose.recall, 1);
  assert.equal(prose.precision, 1);
  assert.equal(prose.rawTranscript, 'His pros is clear.');
  assert.equal(prose.displayTranscript, 'His prose is clear.');

  const postwar = alignSpeech('The postwar era began.', 'The post war era began.');
  assert.equal(postwar.matchRate, 1);
  assert.equal(postwar.rawTranscript, 'The post war era began.');
  assert.equal(postwar.displayTranscript, 'The post war era began.');
});

test('expected-spelling display maps back to raw offsets after safe Unicode and unit normalization', () => {
  for (const [reference, observed] of [['$5 prose', '$5 pros'], ['ﬃ prose', 'ﬃ pros']]) {
    const result = alignSpeech(reference, observed);
    assert.equal(result.matchRate, 1);
    assert.equal(result.rawTranscript, observed);
    assert.equal(result.displayTranscript, reference);
    const equivalent = result.alignment.find(event => event.ruleId === 'prose-pros');
    assert.equal(equivalent?.observed, 'pros');
  }
});

test('approved homophone directions are explicit; unknown pairs do not inherit a rule', () => {
  assert.equal(findSpeechSurfaceMatch('prose', 'pros')?.ruleId, 'prose-pros');
  assert.equal(findSpeechSurfaceMatch('pros', 'prose')?.ruleId, 'pros-prose');
  assert.equal(findSpeechSurfaceMatch('prose', 'praise'), null);
  assert.equal(findSpeechSurfaceMatch('postwar', 'post word'), null);
});

test('edit-distance, Soundex, and apart/a part negatives receive no matching authority', () => {
  for (const [expected, observed] of [
    ['cat', 'cut'],
    ['live', 'love'],
    ['price', 'prize'],
    ['walk', 'talk'],
    ['yell', 'yeah'],
    ['apart', 'a part'],
  ]) {
    const result = alignSpeech(expected, observed);
    assert.equal(result.alignment.length, 0, `${expected} / ${observed}`);
    assert.equal(gradeReadSpeech(result).score, 0, `${expected} / ${observed}`);
  }
});

test('to/too is not an unconditional equivalence because to can be reduced', () => {
  for (const [expected, observed] of [['too', 'to'], ['to', 'too']]) {
    const result = alignSpeech(expected, observed);
    assert.equal(result.alignment.length, 0, `${expected} / ${observed}`);
    assert.equal(gradeReadSpeech(result).score, 0, `${expected} / ${observed}`);
  }
});

test('alignment presentation applies only matched reference token indices', () => {
  const { spans } = presentAlignment('Prose is ready', 'Pros is poor', ['Prose', 'is', 'ready']);
  assert.deepEqual(spans.map(span => span.classes.has('hit')), [true, true, false]);
  assert.deepEqual(spans.map(span => span.classes.has('miss')), [false, false, true]);
});

test('presentation source offsets keep highlights aligned after currency adds a synthetic token', () => {
  const { alignment, spans } = presentAlignment(
    'I paid $5 for prose',
    'I paid $5 prose',
    ['I', 'paid', '5', 'for', 'prose'],
  );
  assert.deepEqual(alignment.missing, ['for']);
  assert.deepEqual(spans.map(span => span.classes.has('hit')), [true, true, true, false, true]);
  assert.deepEqual(spans.map(span => span.classes.has('miss')), [false, false, false, true, false]);
});

test('presentation offsets preserve currency and explicit prose/pros equivalence together', () => {
  const { alignment, spans } = presentAlignment(
    'I paid $5 for prose',
    'I paid $5 for pros',
    ['I', 'paid', '5', 'for', 'prose'],
  );
  assert.equal(alignment.rawTranscript, 'I paid $5 for pros');
  assert.equal(alignment.alignment.some(event => event.ruleId === 'prose-pros'), true);
  assert.deepEqual(spans.map(span => span.classes.has('hit')), [true, true, true, true, true]);
});

test('presentation source offsets keep later highlights aligned after Celsius normalization', () => {
  const { alignment, spans } = presentAlignment(
    'I used 20℃ for prose',
    'I used 20℃ prose',
    ['I', 'used', '20', 'for', 'prose'],
  );
  assert.deepEqual(alignment.missing, ['for']);
  assert.deepEqual(spans.map(span => span.classes.has('hit')), [true, true, true, false, true]);
  assert.deepEqual(spans.map(span => span.classes.has('miss')), [false, false, false, true, false]);
});
