import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferReadHintStage,
  readHintCopy,
  READ_HINT_STAGE_HIDDEN,
  READ_HINT_STAGE_CLOZE,
  READ_HINT_STAGE_FULL,
} from '../scripts/app/hintProgressionCore.js';

test('read hint stages resolve hidden cloze full in order',()=>{
  assert.equal(inferReadHintStage({concealed:true,japaneseVisible:false}),READ_HINT_STAGE_HIDDEN);
  assert.equal(inferReadHintStage({concealed:false,japaneseVisible:false}),READ_HINT_STAGE_CLOZE);
  assert.equal(inferReadHintStage({concealed:false,japaneseVisible:true}),READ_HINT_STAGE_FULL);
});

test('progressive hint copy tells the learner what the next swipe does',()=>{
  assert.match(readHintCopy(READ_HINT_STAGE_HIDDEN).footer,/虫食い/);
  assert.match(readHintCopy(READ_HINT_STAGE_CLOZE).footer,/全文/);
  assert.match(readHintCopy(READ_HINT_STAGE_FULL).footer,/全文表示/);
});
