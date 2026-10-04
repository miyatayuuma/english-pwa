import test from 'node:test';
import assert from 'node:assert/strict';
import { storedMethod, pendingMethod, pendingCourse } from '../scripts/app/learningMenu.js';
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
