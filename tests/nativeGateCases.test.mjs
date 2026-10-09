import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ASR_08D_CASES, acceptanceCase } from '../android/app/src/debug/assets/public/native-gate-cases.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('exactly fourteen D01-D14 acceptance cases appear in the device selector', () => {
  assert.deepEqual(ASR_08D_CASES.map(item => item.id),
    Array.from({ length: 14 }, (_, i) => 'D' + String(i + 1).padStart(2, '0')));
  assert.equal(acceptanceCase('D08').id, 'D08');
  for (const item of ASR_08D_CASES) {
    assert.ok(item.title && item.instruction && item.expected, item.id);
    assert.ok(item.preflight === true || item.preflight === undefined, item.id);
  }
  const gate = read('android/app/src/debug/assets/public/native-gate.html');
  assert.match(gate, /<select id="acceptanceCase"/);
  assert.match(gate, /ASR_08D_CASES\.map\(/);
  assert.match(gate, /caseTitle/);
  assert.match(gate, /caseInstruction/);
  assert.match(gate, /caseExpected/);
  assert.match(gate, /selectAcceptanceCase\(\)/);
  assert.match(gate, /recognitionHarness'\)\.hidden=!chosen\.preflight/);
  assert.match(gate, /acceptanceStatus:'NOT_RUN',harnessOnly:true/);
});

test('harness cannot pretend to test Cloze, Correction, SRS or release privacy', () => {
  for (const id of ['D05','D06','D07','D08','D09','D10','D11','D13','D14']) {
    assert.notEqual(acceptanceCase(id).preflight, true, id);
  }
  assert.equal(acceptanceCase('D01').fixture, 'vocab:00139');
  assert.equal(acceptanceCase('D02').fixture, 'vocab:00437');
  const gate = read('android/app/src/debug/assets/public/native-gate.html');
  assert.match(gate, /通常ゲームのGAME TRACEで検証/);
  assert.match(gate, /getNativeGameTrace\(\)/);
  assert.match(gate, /openGameTrace\(\)/);
});

test('phone navigation uses only debug Java bridge and requires actual validation page', () => {
  const plugin = read('android/app/src/debug/java/com/miyatayuuma/englishpwa/NativeGameTracePlugin.java');
  const activity = read('android/app/src/main/java/com/miyatayuuma/englishpwa/MainActivity.java');
  const nativeSpeech = read('scripts/native/nativeSpeech.js');
  const panel = read('scripts/ui/gameTracePanel.js');
  assert.match(plugin, /public void openGameTrace\(PluginCall call\)/);
  assert.match(plugin, /public void openAcceptanceCases\(PluginCall call\)/);
  assert.match(activity, /if \(!BuildConfig\.DEBUG[\s\S]*?native-gate\.html/);
  assert.match(activity, /nativeSpeechGameTraceLaunch = true/);
  assert.match(activity, /nativeSpeechGameTraceLaunch = false/);
  assert.match(nativeSpeech, /'openGameTrace', 'openAcceptanceCases'/);
  assert.match(panel, /data-action="open-cases"/);
  assert.match(panel, /await nativeBridge\.openAcceptanceCases\(\)/);
  assert.match(panel, /window\.confirm\(/);
});

test('debug APK has a dedicated phone launcher for the case selector, absent from the main manifest', () => {
  const debugManifest = read('android/app/src/debug/AndroidManifest.xml');
  const mainManifest = read('android/app/src/main/AndroidManifest.xml');
  const launcher = read('android/app/src/debug/java/com/miyatayuuma/englishpwa/AsrAcceptanceLauncherActivity.java');
  assert.match(debugManifest, /android:name="\.AsrAcceptanceLauncherActivity"/);
  assert.match(debugManifest, /android:label="ASR実機テスト"/);
  assert.match(debugManifest, /android\.intent\.category\.LAUNCHER/);
  assert.doesNotMatch(mainManifest, /AsrAcceptanceLauncherActivity/);
  assert.match(launcher, /intent\.putExtra\("nativeSpeechGate", true\)/);
  assert.match(launcher, /startActivity\(intent\)/);
});
