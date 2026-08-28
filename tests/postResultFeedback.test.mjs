import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  clearPostResultReveal,
  isPostResultReveal,
  revealCanonicalPostResult,
} from '../scripts/app/postResultFeedback.js';

function fakeEnglishElement({concealed=true,cloze=true}={}){
  const classes=new Set();
  if(concealed) classes.add('concealed');
  if(cloze) classes.add('cloze-active');
  return {
    dataset:{},
    innerHTML:'<span class="tok cloze-mask">hidden</span>',
    classList:{remove(...names){names.forEach(name=>classes.delete(name));},contains(name){return classes.has(name);}},
  };
}

test('hidden and cloze pass reveal the canonical full sentence without hint state',()=>{
  for(const options of [{concealed:true,cloze:false},{concealed:false,cloze:true}]){
    const en=fakeEnglishElement(options);
    const hintState={hintStage:0,maxHintStageUsed:0,noHintSuccess:true};
    let highlighted='';
    const result=revealCanonicalPostResult(en,{id:'E1',en:'This is the canonical answer.'},{rehighlight:(canonical)=>{highlighted=canonical;return {source:'this is answer'};}});
    assert.equal(isPostResultReveal(en,'E1'),true);
    assert.match(en.innerHTML,/This/);
    assert.doesNotMatch(en.innerHTML,/cloze-mask/);
    assert.equal(en.classList.contains('concealed'),false);
    assert.equal(en.classList.contains('cloze-active'),false);
    assert.equal(highlighted,'This is the canonical answer.');
    assert.deepEqual(hintState,{hintStage:0,maxHintStageUsed:0,noHintSuccess:true});
    assert.deepEqual(result,{source:'this is answer'});
  }
});

test('card change clears post-result reveal state',()=>{
  const en=fakeEnglishElement();
  revealCanonicalPostResult(en,{id:'E1',en:'Answer.'});
  clearPostResultReveal(en);
  assert.equal(isPostResultReveal(en,'E1'),false);
});

test('cloze sync prioritizes post-result reveal and pass uses guarded answer-check advance',async()=>{
  const [cloze,main]=await Promise.all([
    readFile(new URL('../scripts/app/clozeMode.js',import.meta.url),'utf8'),
    readFile(new URL('../scripts/app/main.js',import.meta.url),'utf8'),
  ]);
  assert.ok(cloze.indexOf('if(isPostResultReveal(en,itemId))')<cloze.indexOf('const stage=inferReadHintStage'));
  assert.match(cloze,/data-post-result-reveal/);
  assert.match(main,/showPostResultFeedback\(it,matchInfo\)/);
  const silentGuard=main.indexOf('if(!hasRecognizedSpeech(hyp))');
  const passBranch=main.indexOf('if(pass){',silentGuard);
  const revealCall=main.indexOf('showPostResultFeedback(it,matchInfo)',passBranch);
  const failBranch=main.indexOf('}else{',revealCall);
  assert.ok(silentGuard>=0&&silentGuard<passBranch&&passBranch<revealCall&&revealCall<failBranch);
  assert.equal(main.match(/showPostResultFeedback\(it,matchInfo\)/g)?.length,1);
  assert.match(main,/scheduleAutoAdvance\(1900\)/);
  assert.match(main,/generation!==autoAdvanceGeneration\|\|idx!==scheduledIndex/);
  assert.match(main,/function setHintStage[\s\S]*if\(isPostResultReveal\(el\.en,currentItem\?\.id\)\) return false/);
});
