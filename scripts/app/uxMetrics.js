const STORAGE_KEY='uxMetricsV1';
const MAX_EVENTS=320;

function safeRead(storage){
  try{
    const raw=storage?.getItem?.(STORAGE_KEY);
    const parsed=raw?JSON.parse(raw):null;
    if(parsed && Array.isArray(parsed.events)) return parsed;
  }catch(_){}
  return {version:1,events:[]};
}

function safeWrite(storage,data){
  try{ storage?.setItem?.(STORAGE_KEY,JSON.stringify(data)); }catch(_){}
}

function median(values){
  const nums=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!nums.length) return null;
  const mid=Math.floor(nums.length/2);
  return nums.length%2?nums[mid]:(nums[mid-1]+nums[mid])/2;
}

export function summarizeUxEvents(events){
  const safe=Array.isArray(events)?events:[];
  const starts=safe.filter(e=>e.type==='session_start');
  const completes=safe.filter(e=>e.type==='session_complete');
  const timeToStart=starts.map(e=>Number(e.timeToStartMs)).filter(Number.isFinite);
  const taps=starts.map(e=>Number(e.tapsToStart)).filter(Number.isFinite);
  const cards=completes.map(e=>Number(e.cards)).filter(Number.isFinite);
  const hints=completes.map(e=>Number(e.hints)).filter(Number.isFinite);
  const sessions=Math.max(starts.length,completes.length);
  return {
    sessions,
    completed:completes.length,
    completionRate:sessions?completes.length/sessions:0,
    medianTimeToStartMs:median(timeToStart),
    medianTapsToStart:median(taps),
    medianCardsPerSession:median(cards),
    medianHintsPerSession:median(hints),
  };
}

export function createUxMetrics({storage=globalThis.localStorage,now=()=>Date.now()}={}){
  let data=safeRead(storage);
  let appShownAt=now();
  let tapsToStart=0;
  let pendingMode='auto';
  let session=null;

  function persist(){
    if(data.events.length>MAX_EVENTS) data.events=data.events.slice(-MAX_EVENTS);
    safeWrite(storage,data);
  }

  function push(type,payload={}){
    data.events.push({type,at:now(),...payload});
    persist();
  }

  function markAppShown(){
    appShownAt=now(); tapsToStart=0;
    push('app_shown');
  }

  function markStartIntent(mode='auto'){
    tapsToStart+=1;
    pendingMode=mode||'auto';
  }

  function markSessionStarted({planned=0}={}){
    session={startedAt:now(),mode:pendingMode,cards:new Set(),hints:0,failures:new Set()};
    push('session_start',{
      mode:pendingMode,
      planned:Number(planned)||0,
      timeToStartMs:Math.max(0,now()-appShownAt),
      tapsToStart:Math.max(1,tapsToStart||1),
    });
    tapsToStart=0;
  }

  function markCard(itemId){ if(session && itemId) session.cards.add(itemId); }
  function markHint({automatic=false}={}){ if(session) session.hints+=1; push('hint',{automatic:!!automatic}); }
  function markFailure(itemId){ if(session && itemId) session.failures.add(itemId); }

  function markSessionComplete(reason='complete'){
    if(!session) return null;
    const snapshot={
      mode:session.mode,
      cards:session.cards.size,
      hints:session.hints,
      failures:session.failures.size,
      durationMs:Math.max(0,now()-session.startedAt),
      reason,
    };
    push('session_complete',snapshot);
    session=null;
    appShownAt=now();
    return snapshot;
  }

  function markAbandon(reason='abandon'){
    if(!session) return;
    push('session_abandon',{
      mode:session.mode,
      cards:session.cards.size,
      hints:session.hints,
      durationMs:Math.max(0,now()-session.startedAt),
      reason,
    });
    session=null;
    appShownAt=now();
  }

  function summary(){ return summarizeUxEvents(data.events); }
  function events(){ return data.events.slice(); }
  function reset(){ data={version:1,events:[]}; persist(); appShownAt=now(); session=null; }

  return {markAppShown,markStartIntent,markSessionStarted,markCard,markHint,markFailure,markSessionComplete,markAbandon,summary,events,reset};
}
