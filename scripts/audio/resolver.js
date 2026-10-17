export function createAudioUrlResolver({
  resolveFromDirectory=async()=>'',
  resolveFromOPFS=async()=>'',
}={}){
  const urlCache=new Map();
  const pending=new Map();
  let generation=0;
  async function resolveAudioUrl(name){
    if(!name) return '';
    const key=String(name);
    if(urlCache.has(key)) return urlCache.get(key);
    if(pending.has(key)) return pending.get(key);
    const startedGeneration=generation;
    const request=Promise.resolve().then(async()=>{
      let url='';
      try{url=await resolveFromDirectory(key);}catch(_){}
      if(!url){try{url=await resolveFromOPFS(key);}catch(_){}}
      // A folder change invalidates both cached and still-running lookups.
      // Their callers must receive the current source, not overwrite it later.
      if(startedGeneration!==generation) return resolveAudioUrl(key);
      urlCache.set(key,url||'');
      return url||'';
    });
    pending.set(key,request);
    try{return await request;}finally{
      if(pending.get(key)===request) pending.delete(key);
    }
  }
  function clear(){generation++;urlCache.clear();pending.clear();}
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
