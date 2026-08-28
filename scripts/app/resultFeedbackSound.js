export const RESULT_SOUND_MODES=Object.freeze({
  STANDARD:'standard',
  SUBTLE:'subtle',
  OFF:'off',
});

export function normalizeResultSoundMode(value){
  return Object.values(RESULT_SOUND_MODES).includes(value)?value:RESULT_SOUND_MODES.STANDARD;
}

export function createResultFeedbackQueue({
  getMode=()=>RESULT_SOUND_MODES.STANDARD,
  isUnlocked=()=>true,
  playTone=()=>false,
  vibrate=()=>{},
}={}){
  let sequence=0;
  let pending=null;
  const played=new Set();

  function enqueue(type,{itemId='',perfect=false}={}){
    const key=`${String(itemId||'item')}:${++sequence}`;
    pending={key,type:perfect?'perfect':type,itemId:String(itemId||'')};
    try{vibrate(type==='success'?18:10);}catch(_){ }
    return key;
  }

  function clear(){ pending=null; }

  function flush({itemId}={}){
    if(!pending||!isUnlocked()) return false;
    if(itemId!=null&&pending.itemId&&String(itemId)!==pending.itemId){pending=null;return false;}
    const entry=pending;
    pending=null;
    if(played.has(entry.key)) return false;
    played.add(entry.key);
    const mode=normalizeResultSoundMode(getMode());
    if(mode===RESULT_SOUND_MODES.OFF) return false;
    return !!playTone(entry.type,{intensity:mode});
  }

  return {enqueue,flush,clear,hasPending:()=>!!pending};
}
