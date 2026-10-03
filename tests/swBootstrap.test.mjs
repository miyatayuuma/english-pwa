import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../scripts/app/swBootstrap.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('a versioned bootstrap escapes stale cache-first workers and registers updates',()=>{
  assert.match(index,/swBootstrap\.js\?v=5\.66/);
  assert.match(bootstrap,/swUpdatePrompt\.js\?v=5\.66/);
  assert.match(bootstrap,/createSwUpdatePrompt\(\)/);
  assert.match(bootstrap,/registerServiceWorker\(\)/);
});

test('the current worker precaches its update bootstrap',()=>{
  assert.match(worker,/version\.js\?v=5\.66/);
  assert.match(worker,/swBootstrap\.js\?v=5\.66/);
  assert.match(worker,/swUpdatePrompt\.js\?v=5\.66/);
  assert.match(worker,/new Request\(asset,\{cache:'reload'\}\)/);
});

test('the worker installs vocabulary v3 and one-time progress migration assets',()=>{
  const version=fs.readFileSync(new URL('../scripts/version.js',import.meta.url),'utf8');
  assert.match(version,/APP_VERSION\s*=\s*'v5\.66'/);
  assert.match(worker,/\.\/data\/vocabulary-v3\.json/);
  assert.match(worker,/\.\/data\/vocabulary-v3-paraphrase-audit\.json/);
  assert.match(worker,/\.\/data\/vocabulary-v2-v3-migration\.json/);
  assert.doesNotMatch(worker,/vocabulary-v2\.json/);
  for(const asset of [
    './scripts/app/vocabularyMigration.js',
    './scripts/app/clozeRecognitionContext.js',
    './scripts/speech/contextualBias.js',
    './scripts/speech/recognitionChunks.js',
    './scripts/speech/vocabularySpeechEvidence.js',
    './scripts/speech/correctionProgress.js',
    './scripts/app/reorderGuide.js',
    './scripts/app/reorderGrading.js',
    './scripts/reorder/reorderCore.js',
    './scripts/audio/resolver.js',
    './scripts/tagging/quotedTurns.js',
  ]) assert.ok(worker.includes(asset),`${asset} is precached`);
});

test('every install precache path resolves in the repository and the new version clears older caches',()=>{
  const root=new URL('..',import.meta.url);
  const assetBlock=worker.match(/const assets=\[([\s\S]*?)\];/);
  assert.ok(assetBlock,'service worker has a static install asset list');
  const assets=[...assetBlock[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
  assert.ok(assets.includes('./data/vocabulary-v3.json'));
  assert.ok(assets.includes('./data/vocabulary-v3-paraphrase-audit.json'));
  assert.equal(assets.some(asset=>asset.includes('vocabulary-v2.json')),false);
  for(const asset of assets){
    const relative=asset.replace(/^\.\//,'').split('?')[0];
    if(relative) assert.ok(fs.existsSync(new URL(relative,root)),`${asset} exists`);
  }
  assert.match(worker,/keys\.filter\(key\s*=>\s*key\s*!==\s*CACHE\)/);
});
