import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildRelationshipCatalog, recommendCharacter, summarizeRelationshipWorld } from '../scripts/app/relationshipCore.js';

const items=JSON.parse(fs.readFileSync(new URL('../data/items.json',import.meta.url),'utf8'));
const characters=JSON.parse(fs.readFileSync(new URL('../data/characters.json',import.meta.url),'utf8'));
const itemList=Array.isArray(items)?items:items.items;
const characterList=Array.isArray(characters)?characters:characters.characters;

function levelsAt(best){
  return Object.fromEntries(itemList.map(item=>[item.id,{best,last:best,review:{nextDueAt:Date.now()+86400000,intervalMs:86400000}}]));
}

test('all app characters participate in the friendship game and cover all sentences',()=>{
  const relationships=buildRelationshipCatalog(itemList,characterList,{},Date.now());
  assert.equal(relationships.length,20);
  assert.ok(relationships.every(entry=>entry.total>0));
  const world=summarizeRelationshipWorld(itemList,relationships);
  assert.equal(world.assignedItemCount,560);
  assert.ok(recommendCharacter(relationships));
});

test('touching every sentence makes every character a friend',()=>{
  const relationships=buildRelationshipCatalog(itemList,characterList,levelsAt(1),Date.now());
  const world=summarizeRelationshipWorld(itemList,relationships);
  assert.equal(world.friendCount,20);
  assert.equal(world.allFriends,true);
  assert.equal(world.bestFriendCount,0);
});

test('level-four mastery makes every character a durable best friend',()=>{
  const relationships=buildRelationshipCatalog(itemList,characterList,levelsAt(4),Date.now());
  const world=summarizeRelationshipWorld(itemList,relationships);
  assert.equal(world.friendCount,20);
  assert.equal(world.bestFriendCount,20);
  assert.equal(world.allBestFriends,true);
});
