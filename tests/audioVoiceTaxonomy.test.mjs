import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  AUDIO_VOICE_SCHEMA_VERSION,
  needsManualVoiceReview,
  validateAudioVoiceEntry,
} from '../scripts/tagging/audioVoiceTaxonomy.mjs';

const voiceData=JSON.parse(fs.readFileSync(new URL('../data/audio-voice-tags.json',import.meta.url),'utf8'));
const items=JSON.parse(fs.readFileSync(new URL('../data/items.json',import.meta.url),'utf8'));
const itemById=new Map(items.map(item=>[item.id,item]));

test('audio voice dataset uses the current schema and valid records',()=>{
  assert.equal(voiceData.schema_version,AUDIO_VOICE_SCHEMA_VERSION);
  assert.ok(Array.isArray(voiceData.entries));
  assert.ok(voiceData.entries.length>0);
  for(const entry of voiceData.entries){
    assert.deepEqual(validateAudioVoiceEntry(entry),[],`${entry.item_id} must be valid`);
    const item=itemById.get(entry.item_id);
    assert.ok(item,`${entry.item_id} must exist in items.json`);
    assert.equal(entry.audio_fn,item.audio_fn,`${entry.item_id} audio filename must match items.json`);
  }
});

test('voice analysis records are unique by item and filename',()=>{
  const itemIds=voiceData.entries.map(entry=>entry.item_id);
  const audioFns=voiceData.entries.map(entry=>entry.audio_fn);
  assert.equal(new Set(itemIds).size,itemIds.length);
  assert.equal(new Set(audioFns).size,audioFns.length);
});

test('mixed dialogue preserves ordered turn-level voice presentation',()=>{
  const dialogue=voiceData.entries.find(entry=>entry.item_id==='E0009');
  assert.equal(dialogue.voice_presentation,'mixed');
  assert.deepEqual(dialogue.turns.map(turn=>turn.presentation),['masculine','feminine']);
  assert.equal(needsManualVoiceReview(dialogue),false);
});
