import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { adaptiveClozeCount, buildClozeCard, sentenceTokens } from '../scripts/app/clozeLearningCore.js';

const itemsRaw=JSON.parse(fs.readFileSync(new URL('../data/items.json',import.meta.url),'utf8'));
const vocabRaw=JSON.parse(fs.readFileSync(new URL('../data/vocabulary-v2.json',import.meta.url),'utf8'));
const items=Array.isArray(itemsRaw)?itemsRaw:itemsRaw.items;
const entries=Array.isArray(vocabRaw)?vocabRaw:vocabRaw.entries;
const byExample=new Map();
for(const entry of entries){
  for(const itemId of entry.example_ids||[]){
    if(!byExample.has(itemId)) byExample.set(itemId,[]);
    byExample.get(itemId).push(entry);
  }
}

function signature(card){
  return card.targets.map(target=>`${target.entry_id}:${target.tokenStart}-${target.tokenEnd}`).join('|');
}

test('all cloze variants satisfy reconstruction, overlap, range, and load limits',()=>{
  const levels=[0,2,5];
  const variants=[0,1,2,3,4,5];
  let fallbackItems=0;
  let maxHiddenRatio=0;
  let hiddenRatioTotal=0;
  let generatedCount=0;
  let multiCandidateItems=0;
  let variationItems=0;
  const groupDistribution={0:0,1:0,2:0,3:0};

  for(const item of items){
    const vocabulary=byExample.get(item.id)||[];
    const itemSignatures=new Set();
    const itemTargetIds=new Set();
    for(const level of levels){
      for(const variantKey of variants){
        const card=buildClozeCard(item,vocabulary,{level,count:adaptiveClozeCount(item.en,level),variantKey});
        assert.equal(card.segments.map(segment=>segment.text).join(''),item.en,`${item.id}: reconstruction`);
        const tokens=sentenceTokens(item.en);
        let hidden=0;
        for(let index=0;index<card.targets.length;index+=1){
          const target=card.targets[index];
          assert.ok(target.tokenStart>=0&&target.tokenEnd<tokens.length&&target.tokenStart<=target.tokenEnd,`${item.id}: range`);
          if(index>0) assert.ok(card.targets[index-1].tokenEnd<target.tokenStart,`${item.id}: overlap`);
          hidden+=target.tokenEnd-target.tokenStart+1;
          if(!target.fallback) itemTargetIds.add(target.entry_id);
        }
        assert.ok(card.targets.length<=adaptiveClozeCount(item.en,level),`${item.id}: group cap`);
        const ratio=tokens.length?hidden/tokens.length:0;
        const limit=card.targets.some(target=>target.phraseException)?.45:.4;
        assert.ok(ratio<=limit+Number.EPSILON,`${item.id}: hidden ratio ${ratio}`);
        if(card.targets.length) assert.ok(tokens.length-hidden>=2,`${item.id}: too few visible tokens`);
        maxHiddenRatio=Math.max(maxHiddenRatio,ratio);
        hiddenRatioTotal+=ratio;
        generatedCount+=1;
        groupDistribution[card.targets.length]=(groupDistribution[card.targets.length]||0)+1;
        if(level===2) itemSignatures.add(signature(card));
      }
    }
    const representative=buildClozeCard(item,vocabulary,{level:2,variantKey:0});
    if(representative.targets.some(target=>target.fallback)) fallbackItems+=1;
    if(itemTargetIds.size>1) multiCandidateItems+=1;
    if(itemSignatures.size>1) variationItems+=1;
  }

  const summary={
    fallbackItems,
    maxHiddenRatio:Number(maxHiddenRatio.toFixed(4)),
    averageHiddenRatio:Number((hiddenRatioTotal/generatedCount).toFixed(4)),
    multiCandidateItems,
    variationItems,
    groupDistribution,
  };
  console.log(`Cloze dataset audit: ${JSON.stringify(summary)}`);
  assert.equal(items.length,560);
});
