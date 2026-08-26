export const AUDIO_VOICE_SCHEMA_VERSION=1;

export const VOICE_PRESENTATIONS=Object.freeze(['masculine','feminine','mixed','ambiguous']);
export const TURN_PRESENTATIONS=Object.freeze(['masculine','feminine','ambiguous']);
export const VOICE_CONFIDENCE=Object.freeze(['high','medium','low']);
export const VOICE_SOURCES=Object.freeze(['audio_analysis','manual_review']);

const PRESENTATION_SET=new Set(VOICE_PRESENTATIONS);
const TURN_PRESENTATION_SET=new Set(TURN_PRESENTATIONS);
const CONFIDENCE_SET=new Set(VOICE_CONFIDENCE);
const SOURCE_SET=new Set(VOICE_SOURCES);

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
  if(entry?.voice_presentation!=='mixed'&&turns.length>1) errors.push('non-mixed audio cannot contain multiple turns');
  return errors;
}

export function needsManualVoiceReview(entry){
  if(!entry) return true;
  if(entry.voice_presentation==='ambiguous'||entry.confidence==='low') return true;
  return (entry.turns||[]).some(turn=>turn.presentation==='ambiguous'||turn.confidence==='low');
}
