import { matchesTag } from './tagLearningCore.js';

const HOUR_MS=60*60*1000;

export function levelOf(levelState,itemId){
  const info=levelState?.[itemId];
  if(!info || typeof info!=='object') return 0;
  const last=Number(info.last);
  const best=Number(info.best);
  if(Number.isFinite(last)) return Math.max(0,Math.min(5,last));
  if(Number.isFinite(best)) return Math.max(0,Math.min(5,best));
  return 0;
}

export function dueAtOf(levelState,itemId){
  const info=levelState?.[itemId];
  const value=Number(info?.review?.nextDueAt ?? info?.nextDueAt ?? 0);
  return Number.isFinite(value) && value>0 ? value : 0;
}

export function isDue(levelState,itemId,now=Date.now()){
  const dueAt=dueAtOf(levelState,itemId);
  return dueAt>0 && dueAt<=now;
}

export function determineLearningStage(info){
  const last=Number(info?.last);
  const best=Number(info?.best);
  const level=Number.isFinite(last) ? last : (Number.isFinite(best) ? best : 0);
  const noHintStreak=Math.max(0,Number(info?.noHintStreak)||0);
  if(level<=0) return 'acquisition';
  if(level===1) return 'assisted_recall';
  if(level===2) return 'recall';
  if(level===3) return noHintStreak>0 ? 'fluency' : 'recall';
  return 'maintenance';
}

// Kept for compatibility with older tests/imports. Hint progression is now
// exclusively user-driven; session planning must never synthesize swipes.
export function hintSwipesForStage(_stage){
  return 0;
}

export function desiredSessionSize(items,levelState={},now=Date.now(),{min=6,max=8}={}){
  const safe=Array.isArray(items)?items:[];
  const due=safe.reduce((count,item)=>count+(isDue(levelState,item?.id,now)?1:0),0);
  let size=due>=8?8:(due>=3?7:6);
  size=Math.max(min,Math.min(max,size));
  return Math.min(safe.length,size);
}

export function filterByScope(items,scope){
  const safe=Array.isArray(items)?items:[];
  if(!scope?.type || !scope?.id) return safe.slice();
  const includeMedium=scope.includeMedium!==false;
  return safe.filter(item=>matchesTag(item,scope.type,scope.id,{includeMedium}));
}

export function consumeRequestedTagScope(host=globalThis){
  const scope=host?.__ENGLISH_PWA_TAG_SCOPE_REQUEST__;
  if(!scope?.type || !scope?.id) return null;
  try{ delete host.__ENGLISH_PWA_TAG_SCOPE_REQUEST__; }catch(_){ host.__ENGLISH_PWA_TAG_SCOPE_REQUEST__=null; }
  return {
    type:String(scope.type),
    id:String(scope.id),
    includeMedium:scope.includeMedium!==false,
  };
}

function signature(item){
  const character=(Array.isArray(item?.character_tags)?item.character_tags:[])
    .find(tag=>tag?.id && tag.certainty!=='inferred_medium')?.id;
  if(character) return `c:${character}`;
  const grammar=Array.isArray(item?.grammar_tags)?item.grammar_tags[0]:'';
  if(grammar) return `g:${grammar}`;
  const situation=(Array.isArray(item?.situation_tags)?item.situation_tags:[]).find(id=>id && id!=='general');
  if(situation) return `s:${situation}`;
  return '';
}

function candidateMeta(item,levelState,now,index){
  const level=levelOf(levelState,item?.id);
  const info=levelState?.[item?.id]||{};
  const dueAt=dueAtOf(levelState,item?.id);
  const due=dueAt>0 && dueAt<=now;
  const difficulty=Math.max(1,Math.min(10,Number(info?.review?.difficulty ?? info?.difficulty ?? 5)||5));
  const recentRate=Number(info?.lastRate ?? info?.lastMatch ?? info?.lastScore);
  const weakBonus=Number.isFinite(recentRate) && recentRate<0.8 ? 500 : 0;
  const overdueHours=due ? Math.min(240,Math.max(0,(now-dueAt)/HOUR_MS)) : 0;
  let base=0;
  let kind='mastered';
  if(due){ base=10000+overdueHours*3+difficulty*15; kind='due'; }
  else if(level>=1 && level<=3){ base=6500+(4-level)*260+difficulty*20+weakBonus; kind='learning'; }
  else if(level===0){ base=3600; kind='fresh'; }
  else{ base=900+difficulty*8; kind='maintenance'; }
  return {item,index,level,due,dueAt,difficulty,kind,signature:signature(item),base};
}

function selectInterleaved(metas,size){
  const selected=[];
  const remaining=metas.slice();
  let freshUsed=0;
  const freshCap=Math.min(2,Math.max(0,size));
  while(selected.length<size && remaining.length){
    const recent=selected.slice(-2).map(meta=>meta.signature).filter(Boolean);
    let bestIndex=-1;
    let bestScore=-Infinity;
    for(let i=0;i<remaining.length;i+=1){
      const meta=remaining[i];
      if(meta.kind==='fresh' && freshUsed>=freshCap) continue;
      let score=meta.base;
      if(meta.signature && recent.includes(meta.signature)) score-=950;
      if(meta.signature && recent.length===2 && recent[0]===meta.signature && recent[1]===meta.signature) score-=900;
      score-=meta.index*0.0001;
      if(score>bestScore){ bestScore=score; bestIndex=i; }
    }
    if(bestIndex<0) break;
    const [chosen]=remaining.splice(bestIndex,1);
    if(chosen.kind==='fresh') freshUsed+=1;
    selected.push(chosen);
  }
  return selected;
}

export function buildAutomaticSession(items,levelState={},options={}){
  const now=Number(options.now)||Date.now();
  const hasExplicitScope=Object.prototype.hasOwnProperty.call(options,'scope');
  const scope=hasExplicitScope ? options.scope : consumeRequestedTagScope();
  const scoped=filterByScope(items,scope);
  const requested=Number(options.size);
  const size=Number.isFinite(requested) && requested>0
    ? Math.min(scoped.length,Math.max(1,Math.round(requested)))
    : desiredSessionSize(scoped,levelState,now,options);
  const metas=scoped.map((item,index)=>candidateMeta(item,levelState,now,index));
  const selected=selectInterleaved(metas,size);
  const itemsOut=selected.map(meta=>meta.item);
  return {
    items:itemsOut,
    size:itemsOut.length,
    due:selected.filter(meta=>meta.due).length,
    learning:selected.filter(meta=>meta.kind==='learning').length,
    fresh:selected.filter(meta=>meta.kind==='fresh').length,
    maintenance:selected.filter(meta=>meta.kind==='maintenance').length,
    scope:scope||null,
  };
}

export function buildLegacyQueueItems(planItems){
  return (Array.isArray(planItems)?planItems:[]).map((item,index)=>({
    ...item,
    unit:`AUTO-${String(index+1).padStart(3,'0')}`,
  }));
}
