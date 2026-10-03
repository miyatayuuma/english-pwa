import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { isNativePlatform, isNativeAndroid } from '../scripts/native/runtimePlatform.js';
import { createSwUpdatePrompt } from '../scripts/app/swUpdatePrompt.js';
import { getNativeSpeech, nativeSpeechFacade } from '../scripts/native/nativeSpeech.js';

test('native routing follows the bridge, not Android user agent or standalone PWA', () => {
  const browser = { navigator: { userAgent: 'Android', standalone: true } };
  assert.equal(isNativePlatform(browser), false);
  assert.equal(isNativeAndroid(browser), false);
  const android = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } };
  assert.equal(isNativeAndroid(android), true);
  assert.equal(isNativeAndroid({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }), false);
});

test('both SW callers are protected by one native registration guard; Web still registers', async () => {
  const original = Object.getOwnPropertyDescriptors(globalThis);
  let registrations = 0;
  const handlers = [];
  const registration = { addEventListener() {}, update: async () => {} };
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      serviceWorker: { register: async () => { registrations++; return registration; } },
    } });
    globalThis.window = { addEventListener: (_event, callback) => handlers.push(callback) };
    globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    createSwUpdatePrompt().registerServiceWorker();
    assert.equal(handlers.length, 0);
    delete globalThis.Capacitor;
    const web = createSwUpdatePrompt();
    web.registerServiceWorker();
    assert.equal(handlers.length, 1);
    handlers[0]();
    await web.getRegistrationPromise();
    assert.equal(registrations, 1);
  } finally {
    for (const key of ['navigator', 'window', 'Capacitor']) {
      if (original[key]) Object.defineProperty(globalThis, key, original[key]);
      else delete globalThis[key];
    }
  }
});

test('Gate A bridge requires native Android and resolves the custom plugin', async () => {
  await assert.rejects(getNativeSpeech({}), /Capacitor Android/);
  let registered;
  const expected = { isAvailable: async () => ({ available: true }) };
  const scope = { Capacitor: {
    isNativePlatform: () => true, getPlatform: () => 'android',
    registerPlugin: name => { registered = name; return expected; },
  } };
  assert.deepEqual(await (await getNativeSpeech(scope)).isAvailable(), { available: true });
  assert.equal(registered, 'NativeSpeech');
});

test('async bridge acquisition cannot assimilate a Capacitor Proxy as a thenable', async () => {
  let thenAccessed = false;
  const proxy = new Proxy({}, { get: (_target, property) => {
    if (property === 'then') thenAccessed = true;
    return async () => ({ available: true });
  } });
  const facade = await Promise.resolve(nativeSpeechFacade(proxy));
  assert.equal(thenAccessed, false);
  assert.equal(facade.then, undefined);
  assert.deepEqual(await facade.isAvailable(), { available: true });
});

test('staging is deterministic, loads real runtime data and excludes repository tooling', async () => {
  execFileSync(process.execPath, ['scripts/native/stage-web.mjs']);
  async function inventory(directory, prefix = '') {
    const result = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) result.push(...await inventory(directory + '/' + entry.name, relative + '/'));
      else result.push(relative);
    }
    return result.sort();
  }
  const first = await inventory('native-web');
  assert.ok(first.includes('scripts/app/main.js'));
  assert.ok(first.includes('scripts/native/runtimePlatform.js'));
  assert.ok(first.includes('scripts/native/capacitor-core.js'));
  assert.ok(first.includes('styles/components.css'));
  assert.ok(first.includes('data/reorder-v1.json'));
  assert.equal(JSON.parse(await fs.readFile('native-web/data/items.json')).length, 560);
  for (const file of first) assert.ok(!/(?:^sw\.js$|node_modules|^android\/|^tests\/|audit|\.mjs$|\.py$|package|\.github)/.test(file), file);
  assert.equal(await fs.readFile('native-web/index.html', 'utf8'), await fs.readFile('index.html', 'utf8'));
  assert.equal(await fs.readFile('native-web/scripts/native/capacitor-core.js', 'utf8'), await fs.readFile('node_modules/@capacitor/core/dist/index.js', 'utf8'));
  execFileSync(process.execPath, ['scripts/native/stage-web.mjs']);
  assert.deepEqual(await inventory('native-web'), first);
});
