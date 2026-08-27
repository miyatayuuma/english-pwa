import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildExchangeResult } from '../scripts/app/relationshipMode.js';

const character=id=>({id,name:id==='bob'?'Bob':'Jane'});
const relationship=(id,{points=5,rank={id:'familiar',label:'顔なじみ',order:1},intimacy=40}={})=>({id,name:id==='bob'?'Bob':'Jane',character:character(id),friendshipPoints:points,rank,intimacy,intimacyStatus:{label:'会いに行こう'}});

test('normal exchange result shows compact conversation and capped intimacy values',()=>{
  const bob=relationship('bob');
  bob.rawIntimacy=96;
  const result=buildExchangeResult({beforeSnapshot:{bob:{friendshipPoints:5,rankOrder:1,rankId:'familiar',intimacy:38}},relationships:[bob],activeCharacterId:'bob',summary:{conversationCount:7,retryConversationCount:2,failRate:.2}});
  assert.equal(result.title,'今日の交流結果');
  assert.equal(result.conversationCount,7);
  assert.equal(result.revisitCount,2);
  assert.equal(result.intimacyAfter,40);
  assert.equal(result.primaryLabel,'もう少し話す');
});

test('result UI keeps detailed metrics behind the record disclosure and active-character continuation',()=>{
  const relationshipSource=fs.readFileSync(new URL('../scripts/app/relationshipMode.js',import.meta.url),'utf8');
  const sessionSource=fs.readFileSync(new URL('../scripts/app/sessionShell.js',import.meta.url),'utf8');
  assert.match(relationshipSource,/detailsSummary\.textContent='記録を見る'/);
  assert.match(relationshipSource,/reviewCompleteMessage/);
  assert.match(sessionSource,/activeCharacterId\?\{type:'character',id:activeCharacterId\}/);
});

test('rank-up result describes the relationship rank transition',()=>{
  const bob=relationship('bob',{points:10,rank:{id:'friend',label:'友達',order:2},intimacy:69});
  const result=buildExchangeResult({beforeSnapshot:{bob:{friendshipPoints:8,rankOrder:1,rankId:'familiar',intimacy:49}},relationships:[bob],activeCharacterId:'bob'});
  assert.equal(result.rankUp,true);
  assert.equal(result.rankBefore.label,'顔なじみ');
  assert.equal(result.rankAfter.label,'友達');
  assert.match(result.notices[0].text,/友達になった/);
});

test('fresh world milestone becomes a result notice',()=>{
  const result=buildExchangeResult({relationships:[relationship('bob')],freshMilestones:[{id:'friends_5',label:'5人と友達'}]});
  assert.ok(result.notices.some(notice=>notice.kind==='milestone'&&notice.text==='5人と友達を達成！'));
});

test('shared-speaker progress is summarized without exposing raw point gains',()=>{
  const bob=relationship('bob',{points:6,intimacy:42});const jane=relationship('jane',{points:7,intimacy:44});
  const beforeSnapshot={bob:{friendshipPoints:5,rankOrder:1,rankId:'familiar',intimacy:40},jane:{friendshipPoints:5,rankOrder:1,rankId:'familiar',intimacy:40}};
  const result=buildExchangeResult({beforeSnapshot,relationships:[bob,jane],activeCharacterId:'bob'});
  const shared=result.notices.find(notice=>notice.kind==='shared');
  assert.equal(shared.text,'Janeとの関係も進んだ');
  assert.doesNotMatch(shared.text,/\+/);
});
