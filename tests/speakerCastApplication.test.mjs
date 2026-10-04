import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildSpeakerCastPlan } from '../scripts/tagging/speakerCasting.mjs';
import { applySpeakerCastPlan, speakerCastReportPatch } from '../scripts/tagging/speakerCastApplication.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}`,import.meta.url),'utf8'));
const items=read('items.json');
const voice=read('audio-voice-tags.json');
const casting=read('character-casting.json');
const characters=read('characters.json');
const plan=buildSpeakerCastPlan(items,voice,casting,characters);

test('speaker cast application covers every item and synchronizes flat tags',()=>{
  const castItems=applySpeakerCastPlan(items,plan);
  assert.equal(castItems.length,560);
  for(const item of castItems){
    assert.ok(item.speaker_tags.length>=1,`${item.id} should have a speaker`);
    const flat=new Set(String(item.tags||'').split(',').filter(Boolean));
    const expected=new Set(item.speaker_tags.map(speaker=>`speaker:${speaker.id}`));
    const actual=new Set([...flat].filter(tag=>tag.startsWith('speaker:')));
    assert.deepEqual(actual,expected,item.id);
  }
});

test('speaker cast application preserves dialogue order and provenance',()=>{
  const byId=new Map(applySpeakerCastPlan(items,plan).map(item=>[item.id,item]));
  assert.deepEqual(byId.get('E0205').speaker_tags,[
    {id:'nick',source:'contextual',confidence:'high'},
    {id:'lisa',source:'contextual',confidence:'high'},
  ]);
  assert.equal(byId.get('E0001').speaker_tags[0].source,'app_cast');
});

test('speaker cast report exposes complete coverage and slot diagnostics',()=>{
  const castItems=applySpeakerCastPlan(items,plan);
  const patch=speakerCastReportPatch(castItems,plan.diagnostics);
  assert.equal(patch.speaker_tagged_items,560);
  assert.equal(patch.speaker_cast_diagnostics.speaker_slot_count,633);
  assert.equal(Object.values(patch.speaker_counts).reduce((sum,value)=>sum+value,0),633);
});

test('speaker cast application rejects incomplete plans',()=>{
  assert.throws(
    ()=>applySpeakerCastPlan(items,{...plan,entries:plan.entries.slice(1)}),
    /coverage mismatch/,
  );
});
