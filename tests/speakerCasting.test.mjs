import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildSpeakerCastPlan,
  validateSpeakerCastPlan,
} from '../scripts/tagging/speakerCasting.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../data/${name}`,import.meta.url),'utf8'));
const items=read('items.json');
const voice=read('audio-voice-tags.json');
const casting=read('character-casting.json');
const characters=read('characters.json');
const plan=buildSpeakerCastPlan(items,voice,casting,characters);
const byId=new Map(plan.entries.map(entry=>[entry.item_id,entry]));
const profileById=new Map(casting.characters.map(profile=>[profile.id,profile]));

test('speaker cast draft covers all 560 examples without voice mismatch',()=>{
  assert.equal(plan.entries.length,560);
  assert.deepEqual(validateSpeakerCastPlan(plan,items,voice,casting),[]);
  assert.equal(plan.diagnostics.speaker_slot_count,633);
});

test('every cast character receives a useful but bounded share of examples',()=>{
  for(const profile of casting.characters){
    const count=plan.diagnostics.character_counts[profile.id]||0;
    assert.ok(count>=10,`${profile.id} should not be starved: ${count}`);
    assert.ok(count<=60,`${profile.id} should not dominate: ${count}`);
  }
});

test('known direct-address dialogue roles are preserved as contextual speakers',()=>{
  const expected=[
    ['E0124',1,'bob'],
    ['E0161',1,'nick'],
    ['E0212',1,'jane'],
    ['E0221',0,'joe'],
    ['E0285',1,'nick'],
    ['E0355',1,'bob'],
    ['E0366',1,'bob'],
    ['E0504',1,'bob'],
    ['E0541',1,'jane'],
    ['E0560',1,'bob'],
  ];
  for(const [itemId,roleIndex,characterId] of expected){
    const speaker=byId.get(itemId)?.speaker_tags?.[roleIndex];
    assert.equal(speaker?.id,characterId,itemId);
    assert.equal(speaker?.source,'contextual',itemId);
    assert.equal(speaker?.confidence,'high',itemId);
  }
});

test('single-voice narration is not confused with a quoted character inside the sentence',()=>{
  assert.equal(voice.codes_by_item.E0372,'m');
  assert.equal(voice.codes_by_item.E0536,'f');
  assert.equal(profileById.get(byId.get('E0372').speaker_tags[0].id).voice_presentation,'masculine');
  assert.equal(profileById.get(byId.get('E0536').speaker_tags[0].id).voice_presentation,'feminine');
});
