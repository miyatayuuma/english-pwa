import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('only a debug Android launch Intent exposes the NativeGameTrace bridge', () => {
  const activity = read('android/app/src/main/java/com/miyatayuuma/englishpwa/MainActivity.java');
  const plugin = read('android/app/src/debug/java/com/miyatayuuma/englishpwa/NativeGameTracePlugin.java');
  assert.match(activity, /BuildConfig\.DEBUG\s*&&\s*getIntent\(\)\.getBooleanExtra\("nativeSpeechGameTrace", false\)/);
  assert.match(activity, /if \(!BuildConfig\.DEBUG\) return/);
  assert.match(activity, /Class\.forName\("com\.miyatayuuma\.englishpwa\.NativeGameTracePlugin"\)/);
  assert.match(activity, /protected void onNewIntent\(Intent intent\)[\s\S]*?setIntent\(intent\)[\s\S]*?getBooleanExtra\("nativeSpeechGameTrace", false\)/);
  assert.match(plugin, /BuildConfig\.DEBUG\s*&&[\s\S]*?isNativeSpeechGameTraceLaunchEnabled\(\)/);
  assert.match(plugin, /result\.put\("enabled", enabled\)/);
  assert.ok(plugin.includes('package com.miyatayuuma.englishpwa;'));
});

test('web, URL, and storage state cannot enable game tracing', () => {
  const panel = read('scripts/ui/gameTracePanel.js');
  const collector = read('scripts/native/gameTrace.js');
  const nativeSpeech = read('scripts/native/nativeSpeech.js');
  assert.match(panel, /if \(!isNativeAndroid\(\)\) return false/);
  assert.match(panel, /const capability = await nativeBridge\.getCapability\(\)/);
  assert.match(panel, /if \(capability\.enabled\) ensurePanel\(\)/);
  assert.doesNotMatch(panel, /searchParams|location\.search|localStorage|sessionStorage/);
  assert.doesNotMatch(collector, /localStorage|sessionStorage|indexedDB|fetch\(/i);
  assert.match(nativeSpeech, /if \(!isNativeAndroid\(scope\)\) throw new Error\('NativeGameTrace requires/);
  assert.match(collector, /export async function setGameTraceCaptureEnabled\(value\)[\s\S]*?getNativeGameTrace[\s\S]*?capability\?\.enabled !== true[\s\S]*?return false/);
  assert.match(collector, /export const gameTraceCollector = Object\.freeze\([\s\S]*?record: gameTraceCollectorInternal\.record/);
  assert.doesNotMatch(collector, /export const gameTraceCollector = Object\.freeze\([\s\S]*?setEnabled:/);
});

test('actual Read and Vocabulary recognition paths supply the trace collector, while the recorder does not grade or write SRS', () => {
  const recognition = read('scripts/speech/recognition.js');
  const main = read('scripts/app/main.js');
  const vocabulary = read('scripts/app/vocabularyMode.js');
  const collector = read('scripts/native/gameTrace.js');
  assert.match(recognition, /onTraceEvent\(\{/);
  assert.match(main, /onTraceEvent:safeGameTraceRecord/);
  assert.match(vocabulary, /onTraceEvent:safeGameTraceRecord/);
  assert.match(main, /type:'candidate-selected'/);
  assert.match(vocabulary, /type:'candidate-selected'/);
  assert.match(main, /type:'final-ui-result-committed'/);
  assert.match(vocabulary, /type:'final-ui-result-committed'/);
  assert.doesNotMatch(collector, /gradeClozeSpeech|classifyVocabularySpeechAnswer|updateLevelInfo|saveJson/);
});

test('native and JavaScript diagnostics do not log candidate transcript payloads', () => {
  const plugin = read('android/app/src/main/java/com/miyatayuuma/englishpwa/NativeSpeechPlugin.java');
  const backend = read('scripts/native/androidSpeechBackend.js');
  assert.doesNotMatch(plugin, /debug\([^\n]*payload\s*\)/);
  assert.doesNotMatch(plugin, /Log\.d\([^\n]*payload/);
  assert.match(plugin, /retainedCandidateCount/);
  assert.doesNotMatch(backend, /console\?\.debug\?\.\('NativeSpeech', type, value\)/);
  assert.match(backend, /selectedCandidateTranscript|retainedCandidateCount/);
});
