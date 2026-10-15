import test from 'node:test';
import assert from 'node:assert/strict';
import { storedMethod, pendingMethod, pendingCourse, openSessionOptionsFromMenu } from '../scripts/app/learningMenu.js';
import fs from 'node:fs';

test('learning menu owns sentence game selection safely outside browser',()=>{
  assert.equal(storedMethod(),'read');
  assert.equal(pendingMethod({dataset:{pendingMethod:'compose'}}),'compose');
  assert.equal(pendingMethod({dataset:{pendingMethod:'read'}}),'read');
  assert.equal(pendingCourse({dataset:{pendingCourse:'tag'}}),'tag');
  assert.equal(pendingCourse({dataset:{pendingCourse:'unknown'}}),'auto');
});

test('learning menu uses stable feature entry points for range and vocabulary modes',()=>{
  const source=fs.readFileSync(new URL('../scripts/app/learningMenu.js',import.meta.url),'utf8');
  assert.match(source,/__OPEN_ENGLISH_RANGE_BROWSER__/);
  assert.match(source,/__OPEN_VOCABULARY_MODE__/);
});

for(const method of ['read','compose','vocabulary']) test(`details receives pending ${method} and character without committing method`,()=>{
  const previous=globalThis.__OPEN_SESSION_OPTIONS__;
  const previousCharacter=globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__;
  let context,closed=0,shown=0;
  const dialog={dataset:{pendingMethod:method},close:()=>{closed+=1;},showModal:()=>{shown+=1;},querySelector:()=>null,querySelectorAll:()=>[]};
  try{
    globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__='bob';
    globalThis.__OPEN_SESSION_OPTIONS__=value=>{context=value;};
    assert.equal(openSessionOptionsFromMenu(dialog),true);assert.equal(closed,1);
    assert.equal(context.gameMethod,method);assert.equal(context.characterId,'bob');assert.equal(typeof context.onCancel,'function');
    context.onCancel();assert.equal(shown,1);
  }finally{globalThis.__OPEN_SESSION_OPTIONS__=previous;globalThis.__ENGLISH_PWA_ACTIVE_CHARACTER_ID__=previousCharacter;}
});
