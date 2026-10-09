import test from 'node:test';
import assert from 'node:assert/strict';
import { alignSpeech } from '../scripts/speech/speechAlignment.js';
import { applyClozeTargetRequirement, gradeClozeSpeech } from '../scripts/speech/clozeSpeechGrader.js';
import { evaluateRecognitionCandidates } from '../scripts/speech/recognitionCandidates.js';
import { gradeReadSpeech } from '../scripts/speech/readSpeechGrader.js';
import { applySpeechHighlight } from '../scripts/speech/speechPresentation.js';

function fakeEnglish(sentence) {
  const spans = alignSpeech(sentence, '').referenceTokens.map(token => {
    const classes = new Set();
    return {
      textContent: token.raw,
      dataset: {},
      classes,
      classList: {
        toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
    };
  });
  return { spans, querySelectorAll: selector => selector === '.tok' ? spans : [] };
}

function targetBySurface(sentence, surface, entryId) {
  const start = sentence.indexOf(surface);
  assert.notEqual(start, -1);
  return { entry_id: entryId, surface, start, end: start + surface.length };
}

function targetFor(alignment, surface, entryId, occurrence = 0) {
  const sentence = alignment.referenceText;
  let start = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = sentence.indexOf(surface, from);
    if (start === -1) break;
    from = start + surface.length;
  }
  assert.notEqual(start, -1);
  const end = start + surface.length;
  const tokenIndexes = alignment.referenceTokens.flatMap((token, index) => token.end > start && token.start < end ? [index] : []);
  assert.ok(tokenIndexes.length > 0);
  return {
    entry_id: entryId, surface, start, end,
    tokenStart: tokenIndexes[0], tokenEnd: tokenIndexes.at(-1),
  };
}

test('Cloze hidden prose target recognizes approved prose/pros equivalence with provenance', () => {
  const sentence = 'The prose survived the postwar years.';
  const alignment = alignSpeech(sentence, 'The pros survived the postwar years.', { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'C1', sentence,
    targets: [targetFor(alignment, 'prose', 'vocab:01089')],
  });

  assert.equal(result.active, true);
  assert.equal(result.overallScore, 1);
  assert.deepEqual(result.targets.map(({ matched, authority, ruleId, ruleKind, rawTranscript, displayTranscript }) =>
    ({ matched, authority, ruleId, ruleKind, rawTranscript, displayTranscript })), [{
    matched: true,
    authority: 'explicit-equivalence',
    ruleId: 'prose-pros',
    ruleKind: 'homophone',
    rawTranscript: 'The pros survived the postwar years.',
    displayTranscript: 'The prose survived the postwar years.',
  }]);
});

test('Cloze hidden postwar target recognizes explicit segmentation and keeps raw display', () => {
  const sentence = 'The prose survived the postwar years.';
  const alignment = alignSpeech(sentence, 'The prose survived the post war years.', { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'C1', sentence,
    targets: [targetFor(alignment, 'postwar', 'vocab:01943')],
  });

  assert.equal(result.active, true);
  assert.equal(result.overallScore, 1);
  assert.equal(result.targets[0].matched, true);
  assert.equal(result.targets[0].authority, 'explicit-equivalence');
  assert.equal(result.targets[0].ruleId, 'postwar-post-war');
  assert.equal(result.targets[0].ruleKind, 'segmentation-equivalence');
  assert.equal(result.targets[0].rawTranscript, 'The prose survived the post war years.');
  assert.equal(result.targets[0].displayTranscript, 'The prose survived the post war years.');
});

test('Cloze shares Vocabulary ASR spelling and phonetic repairs for hidden targets', () => {
  const cases = [
    { sentence: 'I used to live there.', spoken: 'I use to live there.', surface: 'used to', ruleId: 'shared-read-td-cluster-before-to-vocab-00648-used-to-use' },
    { sentence: 'No sooner had I arrived than the phone rang.', spoken: 'No sooner had I arrived then the phone rang.', surface: 'than', ruleId: 'than-then' },
    { sentence: 'The postwar policy changed.', spoken: 'The post war policy changed.', surface: 'postwar', ruleId: 'postwar-post-war' },
  ];

  for (const [index, item] of cases.entries()) {
    const alignment = alignSpeech(item.sentence, item.spoken, { context: { mode: 'cloze' } });
    const result = gradeClozeSpeech(alignment, {
      itemId: `C-shared-${index}`, sentence: item.sentence,
      targets: [targetFor(alignment, item.surface, `vocab:shared-${index}`)],
    });
    assert.equal(result.overallScore, 1, item.spoken);
    assert.equal(result.targets[0].matched, true, item.spoken);
    assert.equal(result.targets[0].ruleId, item.ruleId, item.spoken);
  }
});

test('Cloze exposes a hidden-target miss independently of a high overall sentence score', () => {
  const sentence = 'The prose survived the postwar years.';
  const alignment = alignSpeech(sentence, 'The progress survived the postwar years.', { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'C1', sentence,
    targets: [targetFor(alignment, 'prose', 'vocab:01089')],
  });

  assert.ok(result.overallScore >= 0.7);
  assert.equal(result.targets[0].matched, false);
  assert.equal(result.targets[0].authority, 'unmatched');
  assert.equal(result.allTargetsMatched, false);

  const gated = applyClozeTargetRequirement({
    candidate: 5, noHintSuccess: true, perfectNoHint: true, pass: true, rate: result.overallScore,
  }, result, 3);
  assert.equal(gated.candidate, 3, 'a target miss cannot promote beyond the prior level');
  assert.equal(gated.pass, false);
  assert.equal(gated.noHintSuccess, false);
  assert.equal(gated.perfectNoHint, false);
});

test('Cloze rejects the production false positive when a complete tail phrase is not reproduced', () => {
  const sentence = 'I did not say that before today during our long meeting.';
  const spoken = 'I, I did not say that before today.';
  const alignment = alignSpeech(sentence, spoken, { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'ASR-08A-tail-omission', sentence,
    targets: [targetBySurface(sentence, 'say that', 'vocab:say-that')],
  });
  const evaluation = applyClozeTargetRequirement({
    candidate: 2, noHintSuccess: false, perfectNoHint: false, pass: true, rate: result.overallScore,
  }, result, 0);

  assert.equal(result.overallScore, 0.7777777777777778, 'the F1 similarity remains visible; completeness owns acceptance');
  assert.equal(result.completeness.complete, false);
  assert.equal(result.pass, false);
  assert.equal(result.targets[0].matched, true);
  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.candidate, 0, 'an incomplete sentence cannot promote or update SRS level');
  assert.equal(evaluation.rate, result.overallScore);
});

test('Cloze final correction alone controls targets, highlights, and completeness', () => {
  const sentence = 'I did not say that before today during our long meeting.';
  const spoken = `${sentence} I did not speak before today during our long`;
  const alignment = alignSpeech(sentence, spoken, { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'ASR-08A-final-correction', sentence,
    targets: [targetBySurface(sentence, 'say that', 'vocab:say-that')],
  });
  const english = fakeEnglish(sentence);
  applySpeechHighlight(result.alignment, english, () => []);
  const targetTokens = result.alignment.referenceTokens.filter(token =>
    token.start < sentence.indexOf('say that') + 'say that'.length
      && token.end > sentence.indexOf('say that'));
  const targetTokenIndexes = targetTokens.map(token => result.alignment.referenceTokens.indexOf(token));

  assert.equal(result.repair.latestRestartSelected, true);
  assert.equal(result.targets[0].matched, false, 'the complete earlier sentence cannot satisfy the final target');
  assert.equal(result.pass, false);
  assert.equal(result.completeness.complete, false, 'the final correction also omits the tail');
  assert.ok(targetTokenIndexes.every(index => english.spans[index].classList.contains('miss')));
  assert.ok(targetTokenIndexes.every(index => !english.spans[index].classList.contains('hit')));
});

test('Cloze final missing-negation score and highlights both use the repaired alignment', () => {
  const sentence = 'I did not say that before today.';
  const spoken = 'I did say that before today.';
  const alignment = alignSpeech(sentence, spoken, { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'ASR-08A-negation', sentence,
    targets: [targetBySurface(sentence, 'say that', 'vocab:say-that')],
  });
  const english = fakeEnglish(sentence);
  applySpeechHighlight(result.alignment, english, () => []);

  assert.equal(result.overallScore, 0);
  assert.equal(result.pass, false);
  assert.equal(result.negationPreserved, false);
  assert.equal(result.alignment.matchedReferenceTokenIndexes.includes(2), false);
  assert.equal(english.spans[2].classList.contains('miss'), true);
  assert.equal(english.spans[2].classList.contains('hit'), false);
});

test('Cloze multi-token target requires every token in its own hidden span', () => {
  const sentence = 'We crossed New York before dawn.';
  const alignment = alignSpeech(sentence, 'We crossed New before dawn.', { context: { mode: 'cloze' } });
  const target = targetFor(alignment, 'New York', 'vocab:new-york');
  const result = gradeClozeSpeech(alignment, { itemId: 'C2', sentence, targets: [target] });

  assert.deepEqual([target.tokenStart, target.tokenEnd], [2, 3]);
  assert.deepEqual(alignment.matchedReferenceTokenIndexes, [0, 1, 2, 4, 5]);
  assert.equal(result.targets[0].matched, false);
  assert.equal(result.allTargetsMatched, false);
});

test('Cloze multi-token target must be a contiguous phrase at its hidden position', () => {
  const sentence = 'We crossed New York before dawn.';
  const alignment = alignSpeech(sentence, 'We crossed New bright York before dawn.', { context: { mode: 'cloze' } });
  const target = targetFor(alignment, 'New York', 'vocab:new-york');
  const result = gradeClozeSpeech(alignment, { itemId: 'C2', sentence, targets: [target] });

  assert.deepEqual(alignment.matchedReferenceTokenIndexes, [0, 1, 2, 3, 4, 5]);
  assert.equal(result.targets[0].matched, false, 'the target words were individually recognized but not as one contiguous phrase');
  assert.equal(result.allTargetsMatched, false);
});

test('Cloze duplicate word elsewhere cannot satisfy the hidden target occurrence', () => {
  const sentence = 'The cat saw another cat.';
  const alignment = alignSpeech(sentence, 'The cat saw another cut.', { context: { mode: 'cloze' } });
  const target = targetFor(alignment, 'cat', 'vocab:cat', 1);
  const result = gradeClozeSpeech(alignment, { itemId: 'C3', sentence, targets: [target] });

  assert.deepEqual([target.tokenStart, target.tokenEnd], [4, 4]);
  assert.ok(alignment.matchedReferenceTokenIndexes.includes(1), 'the visible occurrence matched');
  assert.ok(!alignment.matchedReferenceTokenIndexes.includes(4), 'the hidden occurrence did not match');
  assert.equal(result.targets[0].matched, false);
  assert.equal(result.allTargetsMatched, false);
});

test('Cloze target requirement is inactive when target context does not match the aligned sentence', () => {
  const alignment = alignSpeech('The prose survived.', 'The progress survived.', { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'other', sentence: 'A different sentence.',
    targets: [{ entry_id: 'vocab:01089', surface: 'prose', start: 2, end: 7 }],
  });
  const evaluation = { candidate: 4, noHintSuccess: true, perfectNoHint: false, pass: true };
  assert.equal(result.active, false);
  assert.equal(applyClozeTargetRequirement(evaluation, result), evaluation);
});

test('Cloze prefers the final corrected sentence after a false start and preserves the raw transcript', () => {
  const sentence = 'I had never seen anything like it before.';
  const spoken = 'I had never ... I have ... I had never seen anything like it before.';
  const alignment = alignSpeech(sentence, spoken, { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'C5', sentence,
    targets: [targetFor(alignment, 'never seen', 'vocab:never-seen')],
  });

  assert.equal(result.overallScore, 1);
  assert.equal(result.targets[0].matched, true);
  assert.equal(result.negationPreserved, true);
  assert.equal(result.completeness.complete, true);
  assert.equal(result.pass, true);
  assert.equal(result.repair.latestRestartSelected, true);
  assert.equal(result.repair.selectedTranscript, 'I had never seen anything like it before');
  assert.equal(result.targets[0].rawTranscript, spoken, 'the recognizer evidence remains unchanged');
  assert.equal(result.repair.start, spoken.lastIndexOf('I had never seen'));
  assert.ok(result.alignment.alignment.every(event =>
    spoken.slice(event.observedStart, event.observedEnd) === event.observed),
  'each repaired alignment event points back into the original recognition transcript');
});

test('Cloze ignores repeated words, a mid-sentence restart, and a complete reread', () => {
  const sentence = 'I had never seen anything like it before.';
  const target = targetFor(alignSpeech(sentence, ''), 'anything like it', 'vocab:anything-like-it');
  const cases = [
    'I I had never seen anything like it before.',
    'I had never seen ... seen anything like it before.',
    'I had never seen anything like it before. I had never seen anything like it before.',
  ];

  for (const spoken of cases) {
    const alignment = alignSpeech(sentence, spoken, { context: { mode: 'cloze' } });
    const result = gradeClozeSpeech(alignment, { itemId: 'C6', sentence, targets: [target] });
    assert.equal(result.overallScore, 1, spoken);
    assert.equal(result.targets[0].matched, true, spoken);
    assert.equal(result.completeness.complete, true, spoken);
    assert.equal(result.pass, true, spoken);
    if (spoken.startsWith('I I ')) {
      assert.equal(result.repair.sourceTokenSpans[0].sourceTokenIndex, 1, 'the selected repeated start maps to its original token');
    }
    if (spoken.includes('... seen')) {
      const seenEvent = result.alignment.alignment.find(event => event.expected === 'seen');
      assert.equal(seenEvent.observedStart, spoken.lastIndexOf('seen'), 'deduplicated correction maps to the corrected source occurrence');
      assert.equal(spoken.slice(seenEvent.observedStart, seenEvent.observedEnd), seenEvent.observed);
    }
    if (spoken.startsWith('I I ')) {
      const hadEvent = result.alignment.alignment.find(event => event.expected === 'had');
      assert.equal(hadEvent.observedStart, spoken.indexOf('had'));
      assert.equal(spoken.slice(hadEvent.observedStart, hadEvent.observedEnd), hadEvent.observed);
    }
  }
});

test('Cloze completeness rejects an omitted middle phrase while retaining short ASR-error tolerance', () => {
  const sentence = 'We walked through the old stone bridge before dinner.';
  const target = targetBySurface(sentence, 'through', 'vocab:through');
  const omitted = alignSpeech(sentence, 'We walked through before dinner.', { context: { mode: 'cloze' } });
  const omittedResult = gradeClozeSpeech(omitted, { itemId: 'C-mid-omission', sentence, targets: [target] });
  assert.equal(omittedResult.targets[0].matched, true);
  assert.equal(omittedResult.completeness.complete, false);
  assert.equal(omittedResult.pass, false);
  assert.equal(omittedResult.completeness.blockingSpans[0].text, 'the old stone bridge');

  const clauseSentence = 'We left early because the weather changed.';
  const missingClause = alignSpeech(clauseSentence, 'We left early.', { context: { mode: 'cloze' } });
  const clauseResult = gradeClozeSpeech(missingClause, {
    itemId: 'C-clause-omission', sentence: clauseSentence,
    targets: [targetBySurface(clauseSentence, 'early', 'vocab:early')],
  });
  assert.equal(clauseResult.completeness.complete, false);
  assert.match(clauseResult.completeness.blockingSpans[0].text, /because the weather changed/);

  const asrErrorSentence = 'The quiet old stone bridge was nearby.';
  const oneAsrError = alignSpeech(asrErrorSentence, 'The quiet old stone bridge was weekly.', { context: { mode: 'cloze' } });
  const oneAsrErrorResult = gradeClozeSpeech(oneAsrError, {
    itemId: 'C-asr-error', sentence: asrErrorSentence,
    targets: [targetBySurface(asrErrorSentence, 'quiet', 'vocab:quiet')],
  });
  assert.equal(oneAsrErrorResult.completeness.complete, true, 'a single unrecognized word remains within ASR tolerance');
  assert.equal(oneAsrErrorResult.pass, true);
});

test('Cloze accepts a conservative natural adverb/auxiliary order change only in Cloze', () => {
  const sentence = 'I had never seen anything like it before.';
  const spoken = 'I never had seen anything like it before.';
  const alignment = alignSpeech(sentence, spoken, { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'C7', sentence,
    targets: [targetFor(alignment, 'anything like it', 'vocab:anything-like-it')],
  });

  assert.equal(alignment.orderedMatchIntegrity.valid, false);
  assert.equal(gradeReadSpeech(alignment).score, 0, 'ordinary Read keeps its strict ordering policy');
  assert.equal(result.overallScore, 0.875);
  assert.equal(result.targets[0].matched, true);
  assert.equal(result.negationPreserved, true);
});

test('Cloze does not excuse a missing hidden phrase or a missing final negation', () => {
  const sentence = 'I had never seen anything like it before.';
  const hidden = targetFor(alignSpeech(sentence, ''), 'never seen', 'vocab:never-seen');
  const targetOmitted = alignSpeech(sentence, 'I had never anything like it before.', { context: { mode: 'cloze' } });
  const targetResult = gradeClozeSpeech(targetOmitted, { itemId: 'C8', sentence, targets: [hidden] });
  assert.equal(targetResult.targets[0].matched, false);
  assert.equal(targetResult.allTargetsMatched, false);

  const correctedWithoutNegation = 'I had never seen anything like it before. I have seen anything like it before.';
  const correction = alignSpeech(sentence, correctedWithoutNegation, { context: { mode: 'cloze' } });
  const correctionResult = gradeClozeSpeech(correction, { itemId: 'C8', sentence, targets: [hidden] });
  assert.equal(correctionResult.repair.latestRestartSelected, true);
  assert.equal(correctionResult.negationPreserved, false);
  assert.equal(correctionResult.overallScore, 0);
  assert.equal(correctionResult.pass, false);
  assert.equal(correctionResult.targets[0].matched, false);

  const incompleteRestart = 'I had never seen anything like it before. I have';
  const incomplete = alignSpeech(sentence, incompleteRestart, { context: { mode: 'cloze' } });
  const incompleteResult = gradeClozeSpeech(incomplete, { itemId: 'C8', sentence, targets: [hidden] });
  assert.equal(incompleteResult.repair.latestRestartSelected, true);
  assert.ok(incompleteResult.overallScore < 0.7, 'an incomplete final restart cannot borrow the earlier full sentence');
  assert.equal(incompleteResult.completeness.complete, false);
  assert.equal(incompleteResult.pass, false);
  assert.equal(incompleteResult.targets[0].matched, false);

  const contractedNegation = "I didn't see anything.";
  const contractedTarget = targetFor(alignSpeech(contractedNegation, ''), 'anything', 'vocab:anything');
  const droppedContractedNegation = alignSpeech(contractedNegation, 'I did see anything.', { context: { mode: 'cloze' } });
  const contractedResult = gradeClozeSpeech(droppedContractedNegation, {
    itemId: 'C8', sentence: contractedNegation, targets: [contractedTarget],
  });
  assert.equal(contractedResult.negationPreserved, false);
  assert.equal(contractedResult.overallScore, 0);
});

test('Cloze does not normalize unnatural word order into a correct sentence', () => {
  const sentence = 'The red car arrived early.';
  const spoken = 'The car red arrived early.';
  const alignment = alignSpeech(sentence, spoken, { context: { mode: 'cloze' } });
  const result = gradeClozeSpeech(alignment, {
    itemId: 'C9', sentence,
    targets: [targetFor(alignment, 'red car', 'vocab:red-car')],
  });
  assert.equal(result.overallScore, 0);
  assert.equal(result.targets[0].matched, false);
});

test('Cloze N-best does not combine two partial alternatives into an invented full sentence', () => {
  const sentence = 'I had never seen anything like it before.';
  const target = targetFor(alignSpeech(sentence, ''), 'never seen', 'vocab:never-seen');
  const evidence = {
    primaryTranscript: 'I had never seen',
    recognitionComplete: true,
    completionState: 'terminal',
    recognitionSegments: [{
      segmentIndex: 7,
      isFinal: true,
      alternatives: [
        { transcript: 'I had never seen', asrRank: 0 },
        { transcript: 'I had never seen', asrRank: 1 },
        { transcript: 'anything like it before', asrRank: 2 },
      ],
    }],
  };
  const selection = evaluateRecognitionCandidates(evidence, candidate => {
    const alignment = alignSpeech(sentence, candidate.transcript, { context: { mode: 'cloze' }, asrRank: candidate.asrRank });
    const cloze = gradeClozeSpeech(alignment, { itemId: 'C10', sentence, targets: [target] });
    return { cloze, score: cloze.overallScore, accepted: cloze.pass };
  });

  assert.equal(selection.rescued, false);
  assert.equal(selection.selected.candidate.source, 'primary');
  assert.equal(selection.checked.some(candidate => candidate.accepted), false);
});

test('Read/Cloze selects a finalized lower full-sentence rank only when every hidden target is restored in position',()=>{
  const sentence='We reviewed the postwar proposal and the birthrate estimate.';
  const context={itemId:'C4',sentence,targets:[
    targetFor(alignSpeech(sentence,''),'postwar','vocab:postwar'),
    targetFor(alignSpeech(sentence,''),'birthrate','vocab:birthrate'),
  ]};
  const primary='We reviewed the proposal and the birthrate estimate.';
  const evidence={
    primaryTranscript:primary,
    recognitionComplete:true,
    completionState:'terminal',
    recognitionSegments:[{
      segmentIndex:3,isFinal:true,
      alternatives:[
        {transcript:primary,asrRank:0},
        {transcript:'We reviewed the proposal and the birth rate estimate.',asrRank:1},
        {transcript:'We reviewed the post war proposal and the birth rate estimate.',asrRank:2},
      ],
    }],
  };
  const selection=evaluateRecognitionCandidates(evidence,candidate=>{
    const alignment=alignSpeech(sentence,candidate.transcript,{context:{mode:'cloze'},asrRank:candidate.asrRank});
    const read=gradeReadSpeech(alignment);
    const cloze=gradeClozeSpeech(alignment,context);
    return {alignment,cloze,score:read.score,accepted:cloze.active?cloze.pass:read.score>=0.7};
  });
  assert.equal(selection.rescued,true);
  assert.equal(selection.selected.candidate.asrRank,2);
  assert.equal(selection.selected.cloze.active,true);
  assert.equal(selection.selected.cloze.allTargetsMatched,true);
  assert.deepEqual(selection.selected.cloze.targets.map(target=>target.matched),[true,true]);

  const reversed={...evidence,recognitionSegments:[{
    segmentIndex:3,isFinal:true,
    alternatives:[
      {transcript:primary,asrRank:0},
      {transcript:'We reviewed the birth rate estimate and the post war proposal.',asrRank:1},
    ],
  }]};
  const rejected=evaluateRecognitionCandidates(reversed,candidate=>{
    const alignment=alignSpeech(sentence,candidate.transcript,{context:{mode:'cloze'}});
    const read=gradeReadSpeech(alignment);
    const cloze=gradeClozeSpeech(alignment,context);
    return {alignment,cloze,accepted:cloze.active?cloze.pass:read.score>=0.7};
  });
  assert.equal(rejected.rescued,false);
  assert.equal(rejected.selected.candidate.source,'primary');
});
