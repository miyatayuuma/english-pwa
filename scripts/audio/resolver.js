export function createAudioUrlResolver({
  resolveFromDirectory=async()=>'',
  resolveFromOPFS=async()=>'',
}={}){
  const urlCache=new Map();
  async function resolveAudioUrl(name){
    if(!name) return '';
    const key=String(name);
    if(urlCache.has(key)) return urlCache.get(key);
    let url='';
    try{url=await resolveFromDirectory(key);}catch(_){}
    if(!url){try{url=await resolveFromOPFS(key);}catch(_){}}
    urlCache.set(key,url||'');
    return url||'';
  }
  function clear(){urlCache.clear();}
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
