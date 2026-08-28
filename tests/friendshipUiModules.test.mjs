import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { characterTheme, lobbyConversationCopy } from '../scripts/app/relationshipMode.js';
import { relationshipRankColor } from '../scripts/app/relationshipCore.js';

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

test('relationship rank colors are stable across characters',()=>{
  assert.equal(relationshipRankColor('acquaintance'),'#cbd5e1');
  assert.equal(relationshipRankColor('familiar'),'#7dd3fc');
  assert.equal(relationshipRankColor('friend'),'#86efac');
  assert.equal(relationshipRankColor('close_friend'),'#c4b5fd');
  assert.equal(relationshipRankColor('best_friend'),'#fcd34d');
  assert.equal(relationshipRankColor('unknown'),relationshipRankColor('acquaintance'));
});

test('home lobby keeps the three primary game actions above advanced options',async()=>{
  const source=await readFile(new URL('../scripts/app/relationshipMode.js',import.meta.url),'utf8');
  assert.match(source,/今日の相手/);
  assert.match(source,/に会いに行く/);
  assert.match(source,/chars\.textContent='連絡先'/);
  assert.match(source,/遊び方を変える/);
  assert.match(source,/@media\(max-width:430px\)/);
});

test('character selection uses the same two-stage profile flow in both entrances',async()=>{
  const source=await readFile(new URL('../scripts/app/tagBrowser.js',import.meta.url),'utf8');
  assert.match(source,/if\(!state\.characterOnly\)/);
  assert.match(source,/会いどき/);
  assert.match(source,/の詳細を見る/);
  assert.match(source,/一覧へ戻る/);
  assert.match(source,/前の連絡先/);
  assert.match(source,/次の連絡先/);
  assert.match(source,/state\.characterOnly\?'連絡先':'連絡先・トレーニング'/);
  assert.match(source,/名前を検索/);
  assert.match(source,/touchstart/);
  assert.match(source,/touchend/);
  assert.match(source,/dy>=90/);
  assert.match(source,/合格済み/);
  assert.match(source,/一致率70%以上で1文クリア/);
  assert.match(source,/人物紹介/);
  assert.match(source,/性格・会話テーマ/);
  assert.match(source,/次の関係目標/);
  assert.doesNotMatch(source,/state\.characterOnly&&entry\.type==='character'\)\{startScopedStudy/);
  assert.doesNotMatch(source,/stats\.textContent=`担当/);
});
