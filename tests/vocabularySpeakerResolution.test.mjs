import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOccurrenceSpeaker } from '../scripts/app/vocabularyLearningCore.js';
import { extractQuotedTurns, quotedTurnContainingSpan } from '../scripts/tagging/quotedTurns.js';

const chars=[{id:'alice',name:'Alice'},{id:'bob',name:'Bob'}];
const dialogue={id:'E-D',en:'"first target" "second target" "third target"',speaker_tags:[{id:'alice'},{id:'bob'}]};
function target(text){const start=dialogue.en.indexOf(text);return {start,end:start+text.length};}

test('single-speaker item resolves that character without requiring quoted dialogue',()=>{
  const item={id:'E-S',en:'A target appears here.',speaker_tags:[{id:'alice'}]};
  assert.equal(resolveOccurrenceSpeaker(item,{start:2,end:8},chars)?.profile.name,'Alice');
});

test('dialogue occurrence follows the shared first/second/third alternating turn order',()=>{
  assert.equal(resolveOccurrenceSpeaker(dialogue,target('first target'),chars)?.profile.id,'alice');
  assert.equal(resolveOccurrenceSpeaker(dialogue,target('second target'),chars)?.profile.id,'bob');
  assert.equal(resolveOccurrenceSpeaker(dialogue,target('third target'),chars)?.profile.id,'alice');
});

test('target outside a safely bounded turn and missing character profile have no speaker fallback',()=>{
  const outside={id:'E-O',en:'narration "quoted target"',speaker_tags:[{id:'alice'},{id:'bob'}]};
  assert.equal(resolveOccurrenceSpeaker(outside,{start:0,end:9},chars),null);
  assert.equal(resolveOccurrenceSpeaker(dialogue,target('second target'),[chars[0]]),null);
  assert.equal(resolveOccurrenceSpeaker({...dialogue,speaker_tags:[{id:'alice'},{id:'bob'},{id:'alice'}]},target('first target'),chars),null);
});

test('shared quote parser returns exact UTF-16 turn ranges in casting order',()=>{
  const turns=extractQuotedTurns(dialogue.en);
  assert.deepEqual(turns.map(turn=>turn.text),['first target','second target','third target']);
  const span=target('third target');
  assert.equal(quotedTurnContainingSpan(dialogue.en,span.start,span.end)?.index,2);
  assert.equal(dialogue.en.slice(turns[1].contentStart,turns[1].contentEnd),turns[1].text);
});
