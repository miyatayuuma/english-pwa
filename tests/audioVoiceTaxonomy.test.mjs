import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  AUDIO_VOICE_SCHEMA_VERSION,
  alternatingTurnPresentations,
  expandReviewedVoiceDataset,
  validateAudioVoiceEntry,
  validateReviewedVoiceDataset,
  voiceRolesFromCode,
} from '../scripts/tagging/audioVoiceTaxonomy.mjs';

const voiceData=JSON.parse(fs.readFileSync(new URL('../data/audio-voice-tags.json',import.meta.url),'utf8'));
const items=JSON.parse(fs.readFileSync(new URL('../data/items.json',import.meta.url),'utf8'));

test('reviewed audio voice dataset covers every example exactly once',()=>{
  assert.equal(voiceData.schema_version,AUDIO_VOICE_SCHEMA_VERSION);
  assert.deepEqual(validateReviewedVoiceDataset(voiceData,items),[]);
  assert.equal(Object.keys(voiceData.codes_by_item).length,560);
  const entries=expandReviewedVoiceDataset(voiceData,items);
  assert.equal(entries.length,560);
  for(const entry of entries) assert.deepEqual(validateAudioVoiceEntry(entry),[],`${entry.item_id} must be valid`);
});

test('reviewed voice code totals match the completed sheet audit',()=>{
  const counts={m:0,f:0,mf:0,fm:0};
  for(const code of Object.values(voiceData.codes_by_item)) counts[code]+=1;
  assert.deepEqual(counts,{m:255,f:232,mf:34,fm:39});
});

test('dialogue codes preserve role order and alternate after the second turn',()=>{
  assert.deepEqual(voiceRolesFromCode('mf'),['masculine','feminine']);
  assert.deepEqual(voiceRolesFromCode('fm'),['feminine','masculine']);
  assert.deepEqual(alternatingTurnPresentations('mf',4),['masculine','feminine','masculine','feminine']);
  assert.deepEqual(alternatingTurnPresentations('fm',3),['feminine','masculine','feminine']);
});

test('manually corrected audit exceptions stay fixed',()=>{
  const expected={
    E0063:'fm',E0064:'fm',E0206:'m',E0272:'fm',E0280:'mf',E0303:'m',
    E0332:'fm',E0334:'fm',E0369:'m',E0372:'m',E0466:'f',E0536:'f',
  };
  for(const [id,code] of Object.entries(expected)) assert.equal(voiceData.codes_by_item[id],code,id);
});
