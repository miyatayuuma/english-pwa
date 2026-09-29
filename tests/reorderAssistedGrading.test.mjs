import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLevelStateManager, retainHighestHintStageUsed } from '../scripts/app/levelState.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const levels = createLevelStateManager({
  baseHintStage: 0,
  getFirstHintStage: () => 1,
  getEnglishRevealStage: () => 3,
});

test('a canonical reorder reveal grades 100% speech as assisted under the current level policy', () => {
  assert.deepEqual(levels.evaluateLevel(1, 3), {
    candidate: 3,
    rate: 1,
    stage: 3,
    noHintSuccess: false,
    perfectNoHint: false,
    usedEnglishHint: true,
    revealedEnglishHint: true,
    pass: true,
  });
});

test('a self-completed reorder leaves the base stage eligible for perfect no-hint grading', () => {
  assert.deepEqual(levels.evaluateLevel(1, 0), {
    candidate: 5,
    rate: 1,
    stage: 0,
    noHintSuccess: true,
    perfectNoHint: true,
    usedEnglishHint: false,
    revealedEnglishHint: false,
    pass: true,
  });
});

test('assisted completion raises the recorded stage without lowering prior hint history', () => {
  assert.equal(retainHighestHintStageUsed(0, 3), 3);
  assert.equal(retainHighestHintStageUsed(1, 3), 3);
  assert.equal(retainHighestHintStageUsed(3, 3), 3);
  assert.equal(retainHighestHintStageUsed(4, 3), 4);
});

test('the main completion callback records an assisted stage before showing English or enabling the microphone', async () => {
  const main = await read('scripts/app/main.js');
  const callback = main.match(/onComplete:\s*\(\{ assisted = false \} = \{\}\) => \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(callback, 'reorder completion must consume its assisted payload');
  assert.match(callback, /if\s*\(assisted\)\s*recordHintStageUsed\(COMPOSE_HINT_STAGE_EN\);/);
  assert.match(main, /function recordHintStageUsed\(stage\)\s*\{\s*maxHintStageUsed=retainHighestHintStageUsed\(maxHintStageUsed,stage\);/);
  const recorded = callback.indexOf('recordHintStageUsed(COMPOSE_HINT_STAGE_EN)');
  const english = callback.indexOf('el.en.innerHTML=currentEnHtml');
  const microphone = callback.indexOf('el.mic.disabled=false');
  assert.ok(recorded >= 0 && english > recorded && microphone > english,
    'the assisted grade must be recorded before English reveal and mic enable');
});
