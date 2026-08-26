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
