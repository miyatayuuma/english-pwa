import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const index = read('index.html');
const bootstrap = read('scripts/app/swBootstrap.js');
const worker = read('sw.js');
const assets = JSON.parse(read('runtime-assets.json'));
const appVersion = read('scripts/version.js').match(/APP_VERSION\s*=\s*'v(\d+\.\d+)'/)?.[1];

test('the standalone bootstrap checks for updates independently of app modules', () => {
  assert.ok(appVersion);
  const loader = `<script defer src="scripts/app/swBootstrap.js?v=${appVersion}"`;
  assert.ok(index.includes(loader));
  assert.ok(read('recover.html').includes(loader));
  assert.match(bootstrap, /register\('\.\/sw\.js', \{ updateViaCache: 'none' \}\)/);
  assert.doesNotMatch(bootstrap, /^import\s/m);
  assert.ok(worker.includes(`version.js?v=${appVersion}`));
  assert.ok(assets.includes(`./scripts/app/swBootstrap.js?v=${appVersion}`));
  assert.ok(assets.includes(`./scripts/app/swUpdatePrompt.js?v=${appVersion}`));
  assert.ok(assets.includes('./recover.html'));
});

test('the worker and both builds share the runtime graph with no audit assets', () => {
  for (const asset of assets) {
    assert.ok(fs.existsSync(new URL(asset, root)), `${asset} exists`);
    assert.doesNotMatch(asset, /audit|tests\/|node_modules|capacitor-core\.js/);
  }
  for (const asset of [
    './data/items.json', './data/characters.json', './data/reorder-v1.json',
    './data/vocabulary-v3.json', './data/vocabulary-v2-v3-migration.json',
    './scripts/app/startup.js', './scripts/storage/learningBackup.js',
    './scripts/speech/recognitionCandidates.js', './scripts/app/levelState.js',
    './scripts/app/vocabularyMigration.js', './scripts/speech/speechEquivalence.js',
    './scripts/reorder/reorderCore.js', './scripts/audio/resolver.js',
  ]) assert.ok(assets.includes(asset), `${asset} is precached`);
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE/);
});
