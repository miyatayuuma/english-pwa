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

test('hint copy stays unobtrusive during repeated play',()=>{
  assert.equal(readHintCopy(READ_HINT_STAGE_HIDDEN).placeholder,'…');
  assert.equal(readHintCopy(READ_HINT_STAGE_HIDDEN).footer,'');
  assert.equal(readHintCopy(READ_HINT_STAGE_CLOZE).footer,'');
  assert.equal(readHintCopy(READ_HINT_STAGE_FULL).footer,'');
});
