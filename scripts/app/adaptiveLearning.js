import { matchesTag } from './tagLearningCore.js';

const HOUR_MS=60*60*1000;
const FOCUSED_SESSION_PENDING_KEY='__ENGLISH_PWA_FOCUSED_SESSION_PENDING__';

export const FOCUSED_SESSION_PREPARE_EVENT='english-pwa:prepare-focused-session';

export function markFocusedSessionPending(host=globalThis){
  if(!host) return false;
  host[FOCUSED_SESSION_PENDING_KEY]=true;
  return true;
}

export function consumeFocusedSessionPending(host=globalThis){
  if(!host?.[FOCUSED_SESSION_PENDING_KEY]) return false;
  try{ delete host[FOCUSED_SESSION_PENDING_KEY]; }
  catch(_){ host[FOCUSED_SESSION_PENDING_KEY]=false; }
  return true;
}

export function levelOf(levelState,itemId){
  const info=levelState?.[itemId];
  if(!info||typeof info!=='object') return 0;
  const last=Number(info.last);
  const best=Number(info.best);
  if(Number.isFinite(last)) return Math.max(0,Math.min(5,last));
  if(Number.isFinite(best)) return Math.max(0,Math.min(5,best));
  return 0;
}

export function dueAtOf(levelState,itemId){
  const info=levelState?.[itemId];
  const value=Number(info?.review?.nextDueAt??info?.nextDueAt??0);
  return Number.isFinite(value)&&value>0?value:0;
}

export function isDue(levelState,itemId,now=Date.now()){
  const dueAt=dueAtOf(levelState,itemId);
  return dueAt>0&&dueAt<=now;
}

export function desiredSessionSize(items,levelState={},now=Date.now(),{min=6,max=8}={}){
  const safe=Array.isArray(items)?items:[];
  const due=safe.reduce((count,item)=>count+(isDue(levelState,item?.id,now)?1:0),0);
  // Seven turns is the default game loop. Only a genuinely review-heavy pool
  // expands it; small pools are allowed to shrink below the nominal minimum.
  let size=due>=6?8:7;
  size=Math.max(min,Math.min(max,size));
  return Math.min(safe.length,size);
}

function matchesSection(item,id){
  const raw=String(id??'').trim();
  if(!raw) return true;
  const normalized=/^\d+$/.test(raw)?`Section${raw}`:raw;
  return String(item?.unit||'').toLowerCase()===normalized.toLowerCase();
}

function matchesScopeCondition(item,scope){
  if(!scope) return true;
  if(Array.isArray(scope)) return scope.every(condition=>matchesScopeCondition(item,condition));
  if(Array.isArray(scope.filters)) return scope.filters.every(condition=>matchesScopeCondition(item,condition));
  if(scope.characterId&&!matchesTag(item,'character',scope.characterId)) return false;
  if(scope.skillId&&!matchesTag(item,'skill',scope.skillId)) return false;
  if(scope.section&&!matchesSection(item,scope.section)) return false;
  if(!scope.type||!scope.id) return true;
  if(scope.type==='section') return matchesSection(item,scope.id);
  return matchesTag(item,scope.type,scope.id);
}

export function filterByScope(items,scope){
  const safe=Array.isArray(items)?items:[];
  if(!scope) return safe.slice();
  return safe.filter(item=>matchesScopeCondition(item,scope));
}

export function consumeRequestedTagScope(host=globalThis){
  const scope=host?.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
  if(!scope?.type||!scope?.id) return null;
  try{delete host.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;}catch(_){host.__ENGLISH_PWA_TAG_SCOPE_REQUEST__=null;}
  return {type:String(scope.type),id:String(scope.id)};
}

function signatures(item){
  const values=[];
  for(const tag of Array.isArray(item?.speaker_tags)?item.speaker_tags:[]){ if(tag?.id) values.push(`c:${tag.id}`); }
  for(const id of Array.isArray(item?.grammar_tags)?item.grammar_tags:[]){ if(id) values.push(`g:${id}`); }
  for(const id of Array.isArray(item?.construction_tags)?item.construction_tags:[]){ if(id) values.push(`x:${id}`); }
  if(item?.sentence_patterns?.main) values.push(`p:${item.sentence_patterns.main}`);
  return [...new Set(values)];
}

function candidateMeta(item,levelState,now,index){
  const level=levelOf(levelState,item?.id);
  const info=levelState?.[item?.id]||{};
  const dueAt=dueAtOf(levelState,item?.id);
  const due=dueAt>0&&dueAt<=now;
  const difficulty=Math.max(1,Math.min(10,Number(info?.review?.difficulty??info?.difficulty??5)||5));
  const recentRate=Number(info?.lastRate??info?.lastMatch??info?.lastScore);
  const hintStage=Math.max(0,Number(info?.hintStage)||0);
  const failedRecently=info?.failed===true||info?.lastFailed===true||(Number.isFinite(recentRate)&&recentRate<0.8);
  const weak=level>=1&&level<=3||failedRecently||hintStage>0;
  const weakBonus=(failedRecently?650:0)+(hintStage>0?Math.min(300,hintStage*100):0);
  const overdueHours=due?Math.min(240,Math.max(0,(now-dueAt)/HOUR_MS)):0;
  let base=0;
  let reason='maintenance';
  if(due){base=10000+overdueHours*3+difficulty*15;reason='review';}
  else if(weak){base=6500+(4-Math.min(4,level))*260+difficulty*20+weakBonus;reason='weak';}
  else if(level===0){base=3600;reason='new';}
  else{base=900+difficulty*8;}
  return {item,index,level,due,dueAt,difficulty,failedRecently,reason,signatures:signatures(item),base};
}

function byPriority(a,b){ return b.base-a.base||a.index-b.index; }

function takeHighest(bucket,count){
  return bucket.slice().sort(byPriority).slice(0,Math.max(0,count));
}

function chooseComposition(metas,size){
  const buckets={review:[],weak:[],new:[],maintenance:[]};
  for(const meta of metas) buckets[meta.reason].push(meta);
  const dueAvailable=buckets.review.length;
  const heavyReview=dueAvailable>=6;
  const reviewTarget=Math.min(dueAvailable,heavyReview
    ?Math.max(4,Math.ceil(size*0.57))
    :Math.min(4,size));
  let remaining=Math.max(0,size-reviewTarget);
  const reserveNew=buckets.new.length&&remaining?1:0;
  const weakTarget=Math.min(buckets.weak.length,3,Math.max(0,remaining-reserveNew));
  remaining-=weakTarget;
  const newTarget=Math.min(buckets.new.length,2,remaining);
  remaining-=newTarget;
  const maintenanceTarget=Math.min(buckets.maintenance.length,remaining);

  const chosen=[
    ...takeHighest(buckets.review,reviewTarget),
    ...takeHighest(buckets.weak,weakTarget),
    ...takeHighest(buckets.new,newTarget),
    ...takeHighest(buckets.maintenance,maintenanceTarget),
  ];
  const chosenSet=new Set(chosen);
  let newUsed=chosen.filter(meta=>meta.reason==='new').length;
  const fallback=metas.filter(meta=>!chosenSet.has(meta)).sort((a,b)=>{
    const order={review:0,weak:1,maintenance:2,new:3};
    return order[a.reason]-order[b.reason]||byPriority(a,b);
  });
  for(const meta of fallback){
    if(chosen.length>=size) break;
    if(meta.reason==='new'&&newUsed>=2) continue;
    chosen.push(meta);
    if(meta.reason==='new') newUsed+=1;
  }
  return chosen;
}

function sharedSignatureCount(a,b){
  if(!a?.signatures?.length||!b?.signatures?.length) return 0;
  const compare=new Set(b.signatures);
  return a.signatures.reduce((count,value)=>count+Number(compare.has(value)),0);
}

function interleave(metas){
  const selected=[];
  const remaining=metas.slice();
  while(remaining.length){
    const last=selected.at(-1);
    const previous=selected.at(-2);
    let bestIndex=-1;
    let bestScore=-Infinity;
    for(let i=0;i<remaining.length;i+=1){
      const meta=remaining[i];
      let score=meta.base;
      if(last?.reason===meta.reason) score-=5000;
      score-=sharedSignatureCount(meta,last)*1300;
      score-=sharedSignatureCount(meta,previous)*500;
      score-=meta.index*0.0001;
      if(score>bestScore){bestScore=score;bestIndex=i;}
    }
    const [chosen]=remaining.splice(bestIndex,1);
    selected.push(chosen);
  }
  return selected;
}

const REASON_LABELS=Object.freeze({review:'復習',weak:'苦手',new:'新規',maintenance:'定着'});
const SHORTFALL_LABELS=Object.freeze({
  new_limit:'新しい文は1回2文まで',
  recent_exclusion:'直前に遊んだ文を除外',
  candidate_shortage:'条件に合う文が不足',
});

export function buildAutomaticSession(items,levelState={},options={}){
  const optionNow=Number(options.now);
  const now=Number.isFinite(optionNow)?optionNow:Date.now();
  const hasExplicitScope=Object.prototype.hasOwnProperty.call(options,'scope');
  const scope=hasExplicitScope?options.scope:consumeRequestedTagScope();
  const scoped=filterByScope(items,scope);
  const requested=Number(options.size);
  const target=Number.isFinite(requested)&&requested>0
    ?Math.min(scoped.length,Math.max(1,Math.round(requested)))
    :desiredSessionSize(scoped,levelState,now,options);
  const recentIds=new Set(Array.from(options.recentItemIds||[],String));
  const allMetas=scoped.map((item,index)=>candidateMeta(item,levelState,now,index));
  const metas=allMetas.filter(meta=>!recentIds.has(String(meta.item?.id))||meta.due||meta.failedRecently);
  const recentExcluded=allMetas.length-metas.length;
  const selected=interleave(chooseComposition(metas,target));
  const itemsOut=selected.map(meta=>meta.item);
  const counts={review:0,weak:0,new:0,maintenance:0};
  for(const meta of selected) counts[meta.reason]+=1;
  let shortfallReason=null;
  if(itemsOut.length<target){
    const unusedNew=metas.some(meta=>meta.reason==='new'&&!selected.includes(meta));
    shortfallReason=unusedNew?'new_limit':(recentExcluded?'recent_exclusion':'candidate_shortage');
  }
  return {
    items:itemsOut,
    size:itemsOut.length,
    targetSize:target,
    due:counts.review,
    learning:counts.weak,
    weak:counts.weak,
    fresh:counts.new,
    maintenance:counts.maintenance,
    selections:selected.map(meta=>({item:meta.item,reason:meta.reason,reasonLabel:REASON_LABELS[meta.reason]})),
    selectionReasons:Object.fromEntries(selected.map(meta=>[meta.item.id,meta.reason])),
    composition:{
      target,
      selected:itemsOut.length,
      review:counts.review,
      weak:counts.weak,
      new:counts.new,
      maintenance:counts.maintenance,
      candidates:scoped.length,
      recentExcluded,
      shortfall:Math.max(0,target-itemsOut.length),
      shortfallReason,
      shortfallLabel:shortfallReason?SHORTFALL_LABELS[shortfallReason]:'',
    },
    scope:scope||null,
  };
}

export function buildSessionQueueItems(planItems){
  return (Array.isArray(planItems)?planItems:[]).map((item,index)=>({
    ...item,
    unit:`AUTO-${String(index+1).padStart(3,'0')}`,
  }));
}

// SessionShell still bridges the focused queue into the legacy study runtime.
// Keep this data-only alias until that bridge is absorbed into main.js.
export const buildLegacyQueueItems=buildSessionQueueItems;
