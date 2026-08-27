import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationProgressFor, filterExploreItems, orderedSpeakerIds } from '../scripts/app/sessionShell.js';

test('session shell imports safely outside browser', async()=>{
  const mod=await import('../scripts/app/sessionShell.js');
  assert.equal(typeof mod.filterExploreItems,'function');
});

test('explore filtering does not mutate source items',()=>{
  const items=[
    {id:'a',unit:'1',en:'Hello world',ja:'こんにちは',tags:'greeting'},
    {id:'b',unit:'2',en:'Good night',ja:'おやすみ',tags:'night'},
  ];
  const levels={a:{last:0},b:{last:4}};
  const fresh=filterExploreItems(items,levels,{status:'fresh'});
  const stable=filterExploreItems(items,levels,{status:'stable'});
  assert.deepEqual(fresh.map(item=>item.id),['a']);
  assert.deepEqual(stable.map(item=>item.id),['b']);
  assert.equal(items.length,2);
});

test('conversation speakers keep source order and remove duplicates',()=>{
  assert.deepEqual(orderedSpeakerIds({speaker_tags:[{id:'bob'},{id:'jane'},{id:'bob'},{}]}),['bob','jane']);
  assert.deepEqual(orderedSpeakerIds({}),[]);
});

test('conversation progress follows the generated session plan',()=>{
  const plan=[{id:'a'},{id:'b'},{id:'c'}];
  assert.deepEqual(conversationProgressFor('b',plan),{current:2,total:3});
  assert.deepEqual(conversationProgressFor('missing',plan),{current:1,total:3});
});
