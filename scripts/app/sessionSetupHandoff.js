// Ephemeral, tab-scoped launch intent. Never a learning-data authority.
import { normalizeSessionOptions, SESSION_COUNT_CHOICES } from './sessionOptionsCore.js';
export const SETUP_HANDOFF_KEY='englishPwaSessionSetupHandoff';
export const SETUP_RECEIPT_KEY='englishPwaSessionSetupConsumed';
export const SETUP_HANDOFF_TTL=120_000;
export const GAME_METHODS=Object.freeze(['read','compose','vocabulary']);
export function storedSentenceMethod(){
  try{return JSON.parse(localStorage.getItem('appConfigV3')||'{}')?.studyMode==='compose'?'compose':'read';}catch(_){return 'read';}
}
export const BOOT_SENTENCE_METHOD=storedSentenceMethod();
export function normalizeGameMethod(value,fallback=storedSentenceMethod()){
  return GAME_METHODS.includes(value)?value:(fallback==='compose'?'compose':'read');
}
export function commitSentenceMethod(method){
  if(!['read','compose'].includes(method)) return false;
  try{
    const config=JSON.parse(localStorage.getItem('appConfigV3')||'{}');
    config.studyMode=method;
    localStorage.setItem('appConfigV3',JSON.stringify(config));
    return JSON.parse(localStorage.getItem('appConfigV3'))?.studyMode===method;
  }catch(_){return false;}
}
export function hasSetupHandoff(storage=globalThis.sessionStorage){
  try{return !!storage?.getItem(SETUP_HANDOFF_KEY);}catch(_){return false;}
}
// Captured before either initializer consumes the intent: old course resume
// must never race a custom setup, including a rejected setup intent.
export const BOOT_HAS_SETUP_HANDOFF=hasSetupHandoff();
export function clearSetupHandoff(storage=globalThis.sessionStorage){
  try{storage?.removeItem(SETUP_HANDOFF_KEY);}catch(_){}
}
export function createSetupHandoff({gameMethod,options,appVersion,nonce=globalThis.crypto?.randomUUID?.(),now=Date.now()}){
  if(!['read','compose'].includes(gameMethod)||!nonce||!appVersion) return null;
  const normalized=normalizeSessionOptions(options);
  if(gameMethod==='compose') normalized.trainingMode='standard';
  return {schema:1,appVersion,gameMethod,options:normalized,characterId:normalized.characterId,
    intent:'start',nonce,createdAt:now};
}
export function storeSetupHandoff(payload,storage=globalThis.sessionStorage){
  try{
    if(!payload) return false;
    storage.removeItem('englishPwaPendingGameAction');
    storage.setItem(SETUP_HANDOFF_KEY,JSON.stringify(payload));
    return storage.getItem(SETUP_HANDOFF_KEY)===JSON.stringify(payload);
  }catch(_){clearSetupHandoff(storage);return false;}
}
export function consumeSetupHandoff({storage=globalThis.sessionStorage,appVersion,method,now=Date.now()}={}){
  try{
    const raw=storage.getItem(SETUP_HANDOFF_KEY);
    if(!raw) return null;
    storage.removeItem('englishPwaPendingGameAction');
    storage.removeItem(SETUP_HANDOFF_KEY); // consume before validation/dispatch
    const value=JSON.parse(raw);
    if(value?.schema!==1||value.appVersion!==appVersion||value.intent!=='start'
      ||!['read','compose'].includes(value.gameMethod)||value.gameMethod!==method
      ||typeof value.nonce!=='string'||value.nonce.length<8||value.nonce.length>100
      ||!Number.isFinite(value.createdAt)||now-value.createdAt<0||now-value.createdAt>SETUP_HANDOFF_TTL
      ||!value.options||typeof value.options!=='object'||Array.isArray(value.options)
      ||value.characterId!==value.options.characterId
      ||(!SESSION_COUNT_CHOICES.includes(value.options.count)&&value.options.count!=='custom')
      ||!['auto','review','new','manual'].includes(value.options.mode)
      ||!['standard','continuous_shadowing'].includes(value.options.trainingMode)
      ||(method==='compose'&&value.options.trainingMode!=='standard')
      ||!Array.isArray(value.options.manualItemIds)) return null;
    const receipts=JSON.parse(storage.getItem(SETUP_RECEIPT_KEY)||'{}');
    if(receipts[value.nonce]) return null;
    // Keep all receipts within the validity window; a replay remains rejected
    // even after a different handoff has been consumed.
    const retained=Object.fromEntries(Object.entries(receipts).filter(([,at])=>now-Number(at)<=SETUP_HANDOFF_TTL));
    retained[value.nonce]=now;
    storage.setItem(SETUP_RECEIPT_KEY,JSON.stringify(retained));
    if(!JSON.parse(storage.getItem(SETUP_RECEIPT_KEY)||'{}')[value.nonce]) return null;
    return {...value,options:normalizeSessionOptions(value.options),legacyCountReset:value.options.count==='custom'&&!SESSION_COUNT_CHOICES.includes(String(value.options.customCount))};
  }catch(_){clearSetupHandoff(storage);return null;}
}
