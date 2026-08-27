import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../scripts/app/swBootstrap.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('a versioned bootstrap escapes stale cache-first workers and registers updates',()=>{
  assert.match(index,/swBootstrap\.js\?v=5\.46/);
  assert.match(bootstrap,/swUpdatePrompt\.js\?v=5\.46/);
  assert.match(bootstrap,/createSwUpdatePrompt\(\)/);
  assert.match(bootstrap,/registerServiceWorker\(\)/);
});

test('the current worker precaches its update bootstrap',()=>{
  assert.match(worker,/version\.js\?v=5\.46/);
  assert.match(worker,/swBootstrap\.js\?v=5\.46/);
  assert.match(worker,/swUpdatePrompt\.js\?v=5\.46/);
  assert.match(worker,/new Request\(asset,\{cache:'reload'\}\)/);
});
