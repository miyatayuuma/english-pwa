import test from 'node:test';
import assert from 'node:assert/strict';
import { storedMethod, pendingMethod, pendingCourse } from '../scripts/app/learningMenu.js';

test('learning menu owns sentence game selection safely outside browser',()=>{
  assert.equal(storedMethod(),'read');
  assert.equal(pendingMethod({dataset:{pendingMethod:'compose'}}),'compose');
  assert.equal(pendingMethod({dataset:{pendingMethod:'read'}}),'read');
  assert.equal(pendingCourse({dataset:{pendingCourse:'tag'}}),'tag');
  assert.equal(pendingCourse({dataset:{pendingCourse:'unknown'}}),'auto');
});
