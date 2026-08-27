import { buildAutomaticSession, filterByScope } from './adaptiveLearning.js';

export const SESSION_COUNT_CHOICES=Object.freeze(['auto','5','8','12','custom']);
export const SESSION_SELECTION_MODES=Object.freeze(['auto','review','new','manual']);

export function createDefaultSessionOptions(characterId=''){
  return {
    characterId:String(characterId||''),
    skillId:'',
    section:'',
    count:'auto',
    customCount:7,
    mode:'auto',
    manualItemIds:[],
  };
}

function clampCount(value){
  const number=Math.round(Number(value));
  return Number.isFinite(number)?Math.max(1,Math.min(50,number)):7;
}

export function normalizeSessionOptions(value={}){
  const base=createDefaultSessionOptions(value?.characterId);
  const count=SESSION_COUNT_CHOICES.includes(String(value?.count))?String(value.count):base.count;
  const mode=SESSION_SELECTION_MODES.includes(String(value?.mode))?String(value.mode):base.mode;
  return {
    ...base,
    characterId:String(value?.characterId||''),
    skillId:String(value?.skillId||''),
    section:String(value?.section||''),
    count,
    customCount:clampCount(value?.customCount),
    mode,
    manualItemIds:[...new Set((Array.isArray(value?.manualItemIds)?value.manualItemIds:[]).map(String).filter(Boolean))],
  };
}

export function scopeForSessionOptions(value={}){
  const options=normalizeSessionOptions(value);
  const scope={};
  if(options.characterId) scope.characterId=options.characterId;
  if(options.skillId) scope.skillId=options.skillId;
  if(options.section) scope.section=options.section;
  return Object.keys(scope).length?scope:null;
}

export function requestedCountForSessionOptions(value={}){
  const options=normalizeSessionOptions(value);
  if(options.count==='auto') return null;
  return options.count==='custom'?options.customCount:Number(options.count);
}

export function eligibleItemsForSessionOptions(items,value={}){
  return filterByScope(items,scopeForSessionOptions(value));
}

export function diagnoseEmptySessionOptions(items,value={}){
  const options=normalizeSessionOptions(value);
  if(eligibleItemsForSessionOptions(items,options).length) return [];
  const labels={characterId:'相手',skillId:'特訓テーマ',section:'チャプター'};
  const entries=Object.keys(labels)
    .filter(key=>options[key])
    .map(key=>{
      const relaxed={...options,[key]:''};
      return {key,label:labels[key],available:eligibleItemsForSessionOptions(items,relaxed).length};
    });
  const resolving=entries.filter(entry=>entry.available>0);
  return resolving.length?resolving:entries;
}

export function resetSessionOptions(value={}){
  const options=normalizeSessionOptions(value);
  return createDefaultSessionOptions(options.characterId);
}

function buildManualPlan(items,options){
  const eligible=eligibleItemsForSessionOptions(items,options);
  const eligibleById=new Map(eligible.map(item=>[String(item?.id),item]));
  const requested=options.manualItemIds.map(id=>eligibleById.get(id)).filter(Boolean);
  const limit=requestedCountForSessionOptions(options);
  const selected=limit?requested.slice(0,limit):requested;
  const shortfall=Math.max(0,(limit||selected.length)-selected.length);
  const shortfallReason=shortfall?(selected.length?'candidate_shortage':'manual_empty'):null;
  return {
    items:selected,
    size:selected.length,
    targetSize:limit||selected.length,
    due:0,learning:0,weak:0,fresh:0,maintenance:0,
    selections:selected.map(item=>({item,reason:'manual',reasonLabel:'指定'})),
    selectionReasons:Object.fromEntries(selected.map(item=>[item.id,'manual'])),
    composition:{target:limit||selected.length,selected:selected.length,review:0,weak:0,new:0,maintenance:0,candidates:eligible.length,recentExcluded:0,shortfall,shortfallReason,shortfallLabel:shortfallReason?(selected.length?'指定した文が不足':'例文を選んでください'):''},
    mode:'manual',
    scope:scopeForSessionOptions(options),
  };
}

export function buildSessionPlanFromOptions(items,levelState={},value={},runtimeOptions={}){
  const options=normalizeSessionOptions(value);
  if(options.mode==='manual') return buildManualPlan(items,options);
  const size=requestedCountForSessionOptions(options);
  return buildAutomaticSession(items,levelState,{
    ...runtimeOptions,
    scope:scopeForSessionOptions(options),
    mode:options.mode,
    ...(size?{size}:{}),
  });
}
