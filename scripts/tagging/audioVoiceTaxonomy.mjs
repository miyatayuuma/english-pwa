export const AUDIO_VOICE_SCHEMA_VERSION=2;

export const VOICE_PRESENTATIONS=Object.freeze(['masculine','feminine','mixed','ambiguous']);
export const TURN_PRESENTATIONS=Object.freeze(['masculine','feminine','ambiguous']);
export const VOICE_CONFIDENCE=Object.freeze(['high','medium','low']);
export const VOICE_SOURCES=Object.freeze(['audio_analysis','manual_review']);
export const VOICE_CODES=Object.freeze(['m','f','mf','fm']);

const PRESENTATION_SET=new Set(VOICE_PRESENTATIONS);
const TURN_PRESENTATION_SET=new Set(TURN_PRESENTATIONS);
const CONFIDENCE_SET=new Set(VOICE_CONFIDENCE);
const SOURCE_SET=new Set(VOICE_SOURCES);
const CODE_SET=new Set(VOICE_CODES);

export function voiceRolesFromCode(code){
  const normalized=String(code||'').trim().toLowerCase();
  if(normalized==='m') return ['masculine'];
  if(normalized==='f') return ['feminine'];
  if(normalized==='mf') return ['masculine','feminine'];
  if(normalized==='fm') return ['feminine','masculine'];
  return [];
}

export function alternatingTurnPresentations(code,turnCount){
  const roles=voiceRolesFromCode(code);
  const count=Math.max(0,Number.isInteger(turnCount)?turnCount:0);
  if(!roles.length||!count) return [];
  if(roles.length===1) return Array.from({length:count},()=>roles[0]);
  return Array.from({length:count},(_,index)=>roles[index%2]);
}

export function entryFromReviewedCode(item,code,options={}){
  const roles=voiceRolesFromCode(code);
  if(!roles.length) return null;
  const confidence=CONFIDENCE_SET.has(options.confidence)?options.confidence:'high';
  const source=SOURCE_SET.has(options.source)?options.source:'manual_review';
  return {
    item_id:String(item?.id||''),
    audio_fn:String(item?.audio_fn||''),
    voice_presentation:roles.length===1?roles[0]:'mixed',
    confidence,
    source,
    turns:roles.map((presentation,index)=>({order:index+1,presentation,confidence})),
  };
}

export function expandReviewedVoiceDataset(dataset,items){
  const codes=dataset?.codes_by_item&&typeof dataset.codes_by_item==='object'?dataset.codes_by_item:{};
  return (Array.isArray(items)?items:[]).map(item=>entryFromReviewedCode(item,codes[item.id],{
    confidence:dataset?.confidence,
    source:dataset?.source,
  })).filter(Boolean);
}

export function validateReviewedVoiceDataset(dataset,items){
  const errors=[];
  if(dataset?.schema_version!==AUDIO_VOICE_SCHEMA_VERSION) errors.push('invalid schema_version');
  if(!SOURCE_SET.has(dataset?.source)) errors.push('invalid dataset source');
  if(!CONFIDENCE_SET.has(dataset?.confidence)) errors.push('invalid dataset confidence');
  const safeItems=Array.isArray(items)?items:[];
  const itemIds=new Set(safeItems.map(item=>item?.id).filter(Boolean));
  const codes=dataset?.codes_by_item&&typeof dataset.codes_by_item==='object'?dataset.codes_by_item:{};
  for(const item of safeItems){
    const code=String(codes[item.id]||'').trim().toLowerCase();
    if(!CODE_SET.has(code)) errors.push(`${item.id}: missing or invalid voice code`);
  }
  for(const id of Object.keys(codes)){
    if(!itemIds.has(id)) errors.push(`${id}: voice code has no matching item`);
  }
  return errors;
}

export function validateAudioVoiceEntry(entry){
  const errors=[];
  if(!String(entry?.item_id||'').trim()) errors.push('missing item_id');
  if(!String(entry?.audio_fn||'').trim()) errors.push('missing audio_fn');
  if(!PRESENTATION_SET.has(entry?.voice_presentation)) errors.push('invalid voice_presentation');
  if(!CONFIDENCE_SET.has(entry?.confidence)) errors.push('invalid confidence');
  if(!SOURCE_SET.has(entry?.source)) errors.push('invalid source');
  const turns=Array.isArray(entry?.turns)?entry.turns:[];
  let previousOrder=0;
  for(const turn of turns){
    if(!Number.isInteger(turn?.order)||turn.order<=previousOrder) errors.push('turn order must be strictly increasing positive integers');
    previousOrder=Number.isInteger(turn?.order)?turn.order:previousOrder;
    if(!TURN_PRESENTATION_SET.has(turn?.presentation)) errors.push('invalid turn presentation');
    if(!CONFIDENCE_SET.has(turn?.confidence)) errors.push('invalid turn confidence');
  }
  if(entry?.voice_presentation==='mixed'&&turns.length<2) errors.push('mixed audio requires at least two turns');
  if(entry?.voice_presentation!=='mixed'&&turns.length>1) errors.push('non-mixed audio cannot contain multiple roles');
  return errors;
}

export function needsManualVoiceReview(entry){
  if(!entry) return true;
  if(entry.voice_presentation==='ambiguous'||entry.confidence==='low') return true;
  return (entry.turns||[]).some(turn=>turn.presentation==='ambiguous'||turn.confidence==='low');
}
