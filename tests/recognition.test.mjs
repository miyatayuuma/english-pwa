import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRawTranscriptFinal } from '../scripts/speech/recognition.js';
import { alignSpeech, findSpeechSurfaceMatch } from '../scripts/speech/speechAlignment.js';
import { gradeReadSpeech } from '../scripts/speech/readSpeechGrader.js';
import { applySpeechHighlight } from '../scripts/speech/speechPresentation.js';

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
  const spans = ['Prose', 'is', 'ready'].map(word => {
    const classes = new Set();
    return {
      dataset: { w: word },
      classes,
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      },
    };
  });
  const alignment = alignSpeech('Prose is ready', 'Pros is poor');
  applySpeechHighlight(alignment, { querySelectorAll: () => spans }, () => []);
  assert.deepEqual(spans.map(span => span.classes.has('hit')), [true, true, false]);
  assert.deepEqual(spans.map(span => span.classes.has('miss')), [false, false, true]);
});
