import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildTagCatalog, makeSearchToken } from '../scripts/app/tagLearningCore.js';

const items=JSON.parse(await readFile(new URL('../data/items.json',import.meta.url),'utf8'));
const characterData=JSON.parse(await readFile(new URL('../data/characters.json',import.meta.url),'utf8'));
const characters=characterData.characters||[];

test('production tag catalog exposes every tag family',()=>{
  assert.equal(items.length,560);
  const catalog=buildTagCatalog(items,characters,{},Date.now());
  assert.equal(catalog.character.length,characters.length);
  assert.ok(catalog.situation.length>=10);
  assert.ok(catalog.grammar.length>=10);
  assert.ok(catalog.function.length>=5);
  for(const type of ['character','situation','grammar','function']){
    assert.ok(catalog[type].every(entry=>entry.id&&entry.label&&entry.total>0));
  }
});

test('structured tags have matching namespaced flat search tags',()=>{
  for(const item of items){
    const flat=new Set(String(item.tags||'').split(',').map(x=>x.trim()).filter(Boolean));
    for(const tag of item.character_tags||[]){
      assert.ok(flat.has(makeSearchToken('character',tag.id)),`${item.id}: missing character:${tag.id}`);
    }
    for(const id of item.situation_tags||[]){
      assert.ok(flat.has(makeSearchToken('situation',id)),`${item.id}: missing situation:${id}`);
    }
    for(const id of item.grammar_tags||[]){
      assert.ok(flat.has(makeSearchToken('grammar',id)),`${item.id}: missing grammar:${id}`);
    }
    for(const id of item.function_tags||[]){
      assert.ok(flat.has(makeSearchToken('function',id)),`${item.id}: missing function:${id}`);
    }
  }
});
