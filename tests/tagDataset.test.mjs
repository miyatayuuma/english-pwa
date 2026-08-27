import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildTagCatalog, makeSearchToken } from '../scripts/app/tagLearningCore.js';

const items=JSON.parse(await readFile(new URL('../data/items.json',import.meta.url),'utf8'));
const characterData=JSON.parse(await readFile(new URL('../data/characters.json',import.meta.url),'utf8'));
const characters=characterData.characters||[];

test('production browse catalog exposes only curated speakers and English skills',()=>{
  assert.equal(items.length,560);
  const catalog=buildTagCatalog(items,characters,{},Date.now());
  assert.deepEqual(Object.keys(catalog).sort(),['character','skill']);
  assert.equal(catalog.character.length,characters.length);
  assert.ok(catalog.skill.some(entry=>entry.group==='sentence_pattern'));
  assert.ok(catalog.skill.some(entry=>entry.group==='grammar'));
  assert.ok(catalog.skill.some(entry=>entry.group==='construction'));
  assert.ok(catalog.character.every(entry=>entry.id&&entry.label&&entry.total>0));
  assert.ok(catalog.skill.every(entry=>entry.id&&entry.label&&entry.total>0));
});

test('runtime character catalog is driven by speaker tags',()=>{
  const catalog=buildTagCatalog(items,characters,{},Date.now());
  for(const entry of catalog.character){
    const expected=items.filter(item=>(item.speaker_tags||[]).some(tag=>tag.id===entry.id)).length;
    assert.equal(entry.total,expected,`${entry.id}: speaker count mismatch`);
  }
});

test('retired character context fields and flat tags are absent from production items',()=>{
  for(const item of items){
    assert.equal(Object.hasOwn(item,'character_tags'),false,`${item.id}: legacy character_tags remains`);
    const flat=String(item.tags||'').split(',').map(x=>x.trim()).filter(Boolean);
    assert.equal(flat.some(tag=>tag.startsWith('character:')),false,`${item.id}: legacy character:* tag remains`);
  }
});

test('structured runtime tags have matching namespaced flat tags',()=>{
  for(const item of items){
    const flat=new Set(String(item.tags||'').split(',').map(x=>x.trim()).filter(Boolean));
    for(const tag of item.speaker_tags||[]){
      assert.ok(flat.has(makeSearchToken('speaker',tag.id)),`${item.id}: missing speaker:${tag.id}`);
    }
    for(const id of item.situation_tags||[]){
      assert.ok(flat.has(makeSearchToken('situation',id)),`${item.id}: missing situation:${id}`);
    }
    for(const id of item.grammar_tags||[]){
      assert.ok(flat.has(makeSearchToken('grammar',id)),`${item.id}: missing grammar:${id}`);
    }
    for(const id of item.construction_tags||[]){
      assert.ok(flat.has(makeSearchToken('construction',id)),`${item.id}: missing construction:${id}`);
    }
    for(const id of item.function_tags||[]){
      assert.ok(flat.has(makeSearchToken('function',id)),`${item.id}: missing function:${id}`);
    }
  }
});
