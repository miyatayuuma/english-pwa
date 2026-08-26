import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const root=new URL('../',import.meta.url);

async function text(path){
  return readFile(new URL(path,root),'utf8');
}

test('runtime manifest uses session shell and no retired bridge modules',async()=>{
  const [version,sw]=await Promise.all([text('scripts/version.js'),text('sw.js')]);
  assert.match(version,/sessionShell\.js/);
  assert.match(sw,/sessionShell\.js/);
  for(const retired of ['tagMode.js','gameModeBridge.js']){
    assert.doesNotMatch(version,new RegExp(retired.replace('.','\\.')));
    assert.doesNotMatch(sw,new RegExp(retired.replace('.','\\.')));
  }
});

test('retired runtime source files are physically absent',async()=>{
  for(const path of ['scripts/app/tagMode.js','scripts/app/gameModeBridge.js']){
    await assert.rejects(access(new URL(path,root)));
  }
});

test('duplicate sentence mode preference is retired',async()=>{
  const runtimeFiles=await Promise.all([
    text('scripts/app/learningMenu.js'),
    text('scripts/app/sentencePracticeUx.js'),
    text('scripts/app/composeDefaults.js'),
    text('scripts/app/clozeMode.js'),
  ]);
  runtimeFiles.forEach(source=>assert.doesNotMatch(source,/preferredSentenceMethodV1/));
});

test('automatic hint escalation APIs cannot return through adaptive runtime',async()=>{
  const adaptive=await text('scripts/app/adaptiveLearning.js');
  assert.doesNotMatch(adaptive,/dispatchDownSwipe|applyAdaptiveAssistance|hintSwipesForStage|autoHinting/);
});

test('game switching never clicks the settings form as an indirect bridge',async()=>{
  const menu=await text('scripts/app/learningMenu.js');
  assert.doesNotMatch(menu,/cfgSave|btnCfg|cfgButton\.click|cfgSave\.click/);
});

test('hidden read cards override the legacy 120px minimum height',async()=>{
  const cloze=await text('scripts/app/clozeMode.js');
  assert.match(cloze,/\.en\.concealed\[data-read-hint-stage="0"\][\s\S]*?min-height:0/);
});

test('compose autoplay never force-enables the audio control',async()=>{
  const practice=await text('scripts/app/sentencePracticeUx.js');
  assert.doesNotMatch(practice,/button\.disabled\s*=\s*false/);
});
