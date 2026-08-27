import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync(new URL('../scripts/app/sessionShell.js',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../scripts/app/main.js',import.meta.url),'utf8');

test('study surface is a character conversation with game progress',()=>{
  assert.match(shell,/conversationScene/);
  assert.match(shell,/会話 \$\{progress\.current\}/);
  assert.match(shell,/conversationPrompt/);
  assert.match(shell,/conversation-cast--pair/);
  assert.match(shell,/もう一度話してみる/);
});

test('microphone stays primary while play and staged hint remain available',()=>{
  assert.match(shell,/grid-template-columns:1fr 76px 1fr/);
  assert.match(shell,/conversationHintBtn/);
  assert.match(shell,/english-pwa:request-hint/);
  assert.match(main,/document\.addEventListener\('english-pwa:request-hint',advanceHintStage\)/);
  assert.match(main,/function toggleJA\(\)\{ advanceHintStage\(\); \}/);
});

test('raw metrics are collapsed and the scene covers narrow and reduced-motion layouts',()=>{
  assert.match(shell,/details\.id='conversationDetails'/);
  assert.match(shell,/summary\.textContent='記録・速度'/);
  assert.match(shell,/@media\(max-width:390px\)/);
  assert.match(shell,/@media\(prefers-reduced-motion:reduce\)/);
});
