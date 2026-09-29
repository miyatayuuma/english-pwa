export function createAudioUrlResolver({
  resolveFromDirectory=async()=>'',
  resolveFromOPFS=async()=>'',
  getBaseUrl=()=>'',
  fetchImpl=(...args)=>fetch(...args),
}={}){
  const urlCache=new Map();
  const probeCache=new Map();
  const baseAvailability=new Map();
  const inFlight=new Map();

  async function canFetchFromBase(url,baseKey=''){
    if(!url) return false;
    if(baseKey&&baseAvailability.has(baseKey)&&!baseAvailability.get(baseKey)) return false;
    if(baseKey&&!baseAvailability.has(baseKey)&&inFlight.has(baseKey)){
      if(!await inFlight.get(baseKey)) return false;
    }
    if(probeCache.has(url)) return probeCache.get(url);
    const pending=(async()=>{
      let available=false;
      try{
        const response=await fetchImpl(url,{method:'HEAD'});
        available=!!response?.ok;
        if(baseKey&&response?.status===404) baseAvailability.set(baseKey,false);
      }catch(_){if(baseKey) baseAvailability.set(baseKey,false);}
      probeCache.set(url,available);
      if(baseKey&&available) baseAvailability.set(baseKey,true);
      return available;
    })();
    if(baseKey&&!baseAvailability.has(baseKey)) inFlight.set(baseKey,pending);
    const available=await pending;
    if(inFlight.get(baseKey)===pending) inFlight.delete(baseKey);
    return available;
  }

  async function resolveAudioUrl(name){
    if(!name) return '';
    const key=String(name);
    if(urlCache.has(key)) return urlCache.get(key);
    let url=await resolveFromDirectory(key);
    if(!url) url=await resolveFromOPFS(key);
    const base=String(getBaseUrl()||'').trim().replace(/\/$/,'');
    if(!url&&base){
      const candidate=`${base}/${encodeURI(key)}`;
      if(await canFetchFromBase(candidate,base)) url=candidate;
    }
    urlCache.set(key,url||'');
    return url||'';
  }

  function clear(){urlCache.clear();probeCache.clear();baseAvailability.clear();inFlight.clear();}
  return {resolveAudioUrl,clear,hasCached:name=>urlCache.has(String(name||''))};
}

let sharedResolver=null;
export function configureSharedAudioResolver(resolver){
  sharedResolver=resolver&&typeof resolver.resolveAudioUrl==='function'?resolver:null;
  return sharedResolver;
}
export function resolveSharedAudioUrl(name){
  return sharedResolver?sharedResolver.resolveAudioUrl(name):Promise.resolve('');
}
