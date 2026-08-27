import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { characterTheme, lobbyConversationCopy } from '../scripts/app/relationshipMode.js';

test('friendship UI modules load without a browser runtime',async()=>{
  await import('../scripts/app/relationshipMode.js');
  await import('../scripts/app/tagBrowser.js');
  assert.ok(true);
});

test('game lobby copy and character accent are stable',()=>{
  assert.equal(lobbyConversationCopy('Bob',7),'今日はBobと7つ話そう');
  assert.deepEqual(characterTheme('bob'),characterTheme('bob'));
  assert.notEqual(characterTheme('bob').accent,characterTheme('jane').accent);
});

test('home lobby keeps the three primary game actions above advanced options',async()=>{
  const source=await readFile(new URL('../scripts/app/relationshipMode.js',import.meta.url),'utf8');
  assert.match(source,/今日の相手/);
  assert.match(source,/に会いに行く/);
  assert.match(source,/相手を選ぶ/);
  assert.match(source,/遊び方を変える/);
  assert.match(source,/@media\(max-width:430px\)/);
});

test('character-only roster starts from a face card and hides training tabs',async()=>{
  const source=await readFile(new URL('../scripts/app/tagBrowser.js',import.meta.url),'utf8');
  assert.match(source,/state\.characterOnly&&entry\.type==='character'/);
  assert.match(source,/if\(!state\.characterOnly\)/);
  assert.match(source,/会いどき/);
  assert.doesNotMatch(source,/stats\.textContent=`担当/);
});
