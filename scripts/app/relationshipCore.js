const HOUR_MS=60*60*1000;
const MIN_DECAY_INTERVAL_MS=12*HOUR_MS;
const INTIMACY_FLOOR=0.35;

export const RELATIONSHIP_RANKS=Object.freeze([
  Object.freeze({id:'acquaintance',label:'知り合い',order:0}),
  Object.freeze({id:'familiar',label:'顔なじみ',order:1}),
  Object.freeze({id:'friend',label:'友達',order:2}),
  Object.freeze({id:'close_friend',label:'仲良し',order:3}),
  Object.freeze({id:'best_friend',label:'親友',order:4}),
]);

export const RELATIONSHIP_INTIMACY_CAPS=Object.freeze({
  acquaintance:24,
  familiar:49,
  friend:69,
  close_friend:89,
  best_friend:100,
});

export const RELATIONSHIP_MILESTONES=Object.freeze([
  Object.freeze({id:'friends_5',kind:'friend',count:5,label:'5人と友達'}),
  Object.freeze({id:'friends_10',kind:'friend',count:10,label:'10人と友達'}),
  Object.freeze({id:'friends_all',kind:'friend',count:'all',label:'みんなと友達'}),
  Object.freeze({id:'best_friends_5',kind:'best_friend',count:5,label:'5人と親友'}),
  Object.freeze({id:'best_friends_10',kind:'best_friend',count:10,label:'10人と親友'}),
  Object.freeze({id:'best_friends_all',kind:'best_friend',count:'all',label:'みんなと親友'}),
]);

function clamp(value,min,max){ return Math.max(min,Math.min(max,value)); }
function finite(value,fallback=0){ const n=Number(value);return Number.isFinite(n)?n:fallback; }

export function bestLevelOf(levelState,itemId){
  const info=levelState?.[itemId];
  if(!info||typeof info!=='object') return 0;
  return clamp(Math.max(finite(info.best,0),finite(info.last,0)),0,5);
}

export function currentLevelOf(levelState,itemId){
  const info=levelState?.[itemId];
  if(!info||typeof info!=='object') return 0;
  const last=Number(info.last);
  if(Number.isFinite(last)) return clamp(last,0,5);
  return clamp(finite(info.best,0),0,5);
}

export function freshnessOf(levelState,itemId,now=Date.now()){
  const info=levelState?.[itemId];
  const best=bestLevelOf(levelState,itemId);
  if(best<=0||!info||typeof info!=='object') return 0;
  const dueAt=finite(info.review?.nextDueAt??info.nextDueAt,0);
  if(dueAt<=0||now<=dueAt) return 1;
  const interval=Math.max(MIN_DECAY_INTERVAL_MS,finite(info.review?.intervalMs??info.intervalMs,MIN_DECAY_INTERVAL_MS));
  const overdueRatio=Math.max(0,(now-dueAt)/interval);
  return Math.max(INTIMACY_FLOOR,1/(1+0.7*overdueRatio));
}

export function hasSpeaker(item,characterId){
  return (Array.isArray(item?.speaker_tags)?item.speaker_tags:[]).some(tag=>tag?.id===characterId);
}

function rankForCounts(total,started,mastered){
  if(total<=0) return RELATIONSHIP_RANKS[0];
  if(mastered>=total) return RELATIONSHIP_RANKS[4];
  if(started>=total&&mastered>=Math.ceil(total*0.5)) return RELATIONSHIP_RANKS[3];
  if(started>=total) return RELATIONSHIP_RANKS[2];
  if(started>=Math.ceil(total*0.5)) return RELATIONSHIP_RANKS[1];
  return RELATIONSHIP_RANKS[0];
}

function nextTargetForCounts(total,started,mastered,stable,rank){
  if(total<=0) return {label:'',remaining:0,progress:0};
  const half=Math.ceil(total*0.5);
  if(rank.id==='acquaintance'){
    return {label:'顔なじみ',remaining:Math.max(0,half-started),progress:clamp(started/Math.max(1,half),0,1)};
  }
  if(rank.id==='familiar'){
    return {label:'友達',remaining:Math.max(0,total-started),progress:clamp((started-half)/Math.max(1,total-half),0,1)};
  }
  if(rank.id==='friend'){
    return {label:'仲良し',remaining:Math.max(0,half-mastered),progress:clamp(mastered/Math.max(1,half),0,1)};
  }
  if(rank.id==='close_friend'){
    return {label:'親友',remaining:Math.max(0,total-mastered),progress:clamp((mastered-half)/Math.max(1,total-half),0,1)};
  }
  return {label:'完全定着',remaining:Math.max(0,total-stable),progress:clamp(stable/Math.max(1,total),0,1)};
}

function intimacyStatus(value,due){
  if(value>=85&&due===0) return {id:'connected',label:'いい感じ'};
  if(value>=70) return {id:'steady',label:due>0?'そろそろ会いどき':'安定している'};
  if(value>=50) return {id:'cooling',label:'少し間が空いてる'};
  return {id:'reconnect',label:'会いに行こう'};
}

export function buildCharacterRelationship(items,character,levelState={},now=Date.now()){
  const id=character?.id;
  const matched=(Array.isArray(items)?items:[]).filter(item=>id&&hasSpeaker(item,id));
  let started=0,mastered=0,stable=0,due=0,friendshipPoints=0,intimacySum=0;
  let overdueRatioSum=0;
  for(const item of matched){
    const best=bestLevelOf(levelState,item.id);
    // Lv2 is the first passing level and represents a best speech match of at
    // least 70%. Keep the highest achievement durable, so a later weak retry
    // does not take an already-cleared sentence away from relationship progress.
    if(best>=2) started+=1;
    if(best>=4) mastered+=1;
    if(best>=5) stable+=1;
    friendshipPoints+=Math.min(4,best);
    const info=levelState?.[item.id]||{};
    const dueAt=finite(info.review?.nextDueAt??info.nextDueAt,0);
    if(best>0&&dueAt>0&&dueAt<=now){
      due+=1;
      const interval=Math.max(MIN_DECAY_INTERVAL_MS,finite(info.review?.intervalMs??info.intervalMs,MIN_DECAY_INTERVAL_MS));
      overdueRatioSum+=Math.max(0,(now-dueAt)/interval);
    }
    const competence=clamp(best/4,0,1);
    intimacySum+=competence*freshnessOf(levelState,item.id,now);
  }
  const total=matched.length;
  const rank=rankForCounts(total,started,mastered);
  const rawIntimacy=total?Math.round(intimacySum/total*100):0;
  const intimacyCap=RELATIONSHIP_INTIMACY_CAPS[rank.id]??100;
  const intimacy=Math.min(rawIntimacy,intimacyCap);
  const next=nextTargetForCounts(total,started,mastered,stable,rank);
  const maxFriendshipPoints=total*4;
  return {
    id,
    name:character?.name||id||'',
    character,
    total,started,mastered,stable,due,
    startedRate:total?started/total:0,
    masteryRate:total?mastered/total:0,
    friendshipPoints,
    maxFriendshipPoints,
    rank,
    next,
    rawIntimacy,
    intimacyCap,
    intimacy,
    intimacyStatus:intimacyStatus(intimacy,due),
    overdueRatio:due?overdueRatioSum/due:0,
  };
}

export function buildRelationshipCatalog(items,characters,levelState={},now=Date.now()){
  return (Array.isArray(characters)?characters:[])
    .filter(character=>character?.id)
    .map(character=>buildCharacterRelationship(items,character,levelState,now))
    .filter(entry=>entry.total>0);
}

export function summarizeRelationshipWorld(items,relationships){
  const safe=Array.isArray(relationships)?relationships:[];
  const totalCharacters=safe.length;
  const friendCount=safe.filter(entry=>entry.rank.order>=2).length;
  const bestFriendCount=safe.filter(entry=>entry.rank.order>=4).length;
  const connectedCount=safe.filter(entry=>entry.rank.order>=4&&entry.intimacy>=75).length;
  const safeItems=Array.isArray(items)?items:[];
  const assignedIds=new Set();
  for(const entry of safe){
    for(const item of safeItems){ if(hasSpeaker(item,entry.id)) assignedIds.add(item.id); }
  }
  return {
    totalCharacters,
    friendCount,
    bestFriendCount,
    connectedCount,
    allFriends:totalCharacters>0&&friendCount===totalCharacters,
    allBestFriends:totalCharacters>0&&bestFriendCount===totalCharacters,
    assignedItemCount:assignedIds.size,
  };
}

export function reachedMilestones(world){
  const total=Math.max(0,Number(world?.totalCharacters)||0);
  return RELATIONSHIP_MILESTONES.filter(milestone=>{
    const target=milestone.count==='all'?total:Number(milestone.count);
    if(target<=0) return false;
    const count=milestone.kind==='friend'?Number(world?.friendCount)||0:Number(world?.bestFriendCount)||0;
    return count>=target;
  });
}

export function nextWorldMilestone(world){
  const reached=new Set(reachedMilestones(world).map(x=>x.id));
  return RELATIONSHIP_MILESTONES.find(x=>!reached.has(x.id))||null;
}

export function recommendCharacter(relationships,{recentCharacterIds=[]}={}){
  const safe=Array.isArray(relationships)?relationships.filter(Boolean):[];
  if(!safe.length) return null;
  const allBest=safe.every(entry=>entry.rank.order>=4);
  const recent=[...new Set(Array.from(recentCharacterIds||[],String).filter(Boolean))].slice(0,4);
  return safe.slice().sort((a,b)=>{
    const score=(entry)=>{
      const dueRate=entry.total?entry.due/entry.total:0;
      const tier=entry.character?.tier==='main'?8:(entry.character?.tier==='supporting'?4:0);
      const recentIndex=recent.indexOf(String(entry.id));
      // Rotate ordinary recommendations, but never suppress genuinely urgent
      // reviews. The most recent partner receives the largest soft penalty.
      const rotationPenalty=dueRate>=0.35||recentIndex<0?0:[24,12,6,3][recentIndex];
      if(allBest) return dueRate*70+(100-entry.intimacy)*0.55+entry.overdueRatio*8+tier*0.1-rotationPenalty;
      const inProgress=entry.started>0&&entry.rank.order<4?22:0;
      const coveragePriority=entry.rank.order<2?18:0;
      const nextCloseness=entry.next?.progress?entry.next.progress*18:0;
      const stale=entry.started>0?(100-entry.intimacy)*0.12:0;
      return dueRate*55+inProgress+coveragePriority+nextCloseness+stale+tier-rotationPenalty;
    };
    return score(b)-score(a)||b.rank.order-a.rank.order||b.total-a.total||String(a.name).localeCompare(String(b.name));
  })[0];
}

export function snapshotRelationships(relationships){
  const out={};
  for(const entry of Array.isArray(relationships)?relationships:[]){
    if(!entry?.id) continue;
    out[entry.id]={friendshipPoints:entry.friendshipPoints,rankOrder:entry.rank.order,rankId:entry.rank.id,intimacy:entry.intimacy};
  }
  return out;
}

export function compareRelationshipSnapshots(before,afterRelationships){
  const prev=before&&typeof before==='object'?before:{};
  const deltas=[];
  for(const entry of Array.isArray(afterRelationships)?afterRelationships:[]){
    const old=prev[entry.id]||{friendshipPoints:0,rankOrder:0,intimacy:0};
    const pointGain=Math.max(0,entry.friendshipPoints-finite(old.friendshipPoints,0));
    const rankUp=entry.rank.order>finite(old.rankOrder,0);
    const intimacyGain=entry.intimacy-finite(old.intimacy,0);
    if(pointGain>0||rankUp||intimacyGain>0){
      deltas.push({id:entry.id,name:entry.name,pointGain,rankUp,rank:entry.rank,intimacyGain,intimacy:entry.intimacy});
    }
  }
  return deltas.sort((a,b)=>Number(b.rankUp)-Number(a.rankUp)||b.pointGain-a.pointGain||b.intimacyGain-a.intimacyGain);
}
