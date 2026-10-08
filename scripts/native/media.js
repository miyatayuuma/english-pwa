import { isNativeAndroid } from './runtimePlatform.js';
let pluginPromise;
export function getNativeMedia(){
  if(!isNativeAndroid()) return Promise.reject(new Error('Android shell required'));
  return pluginPromise ||= import('./capacitor-core.js').then(({registerPlugin})=>{
    const proxy=registerPlugin('NativeMedia');
    return Object.fromEntries(['pick','status','clear','read','voices','speak','cancel','addListener'].map(key=>[key,(...args)=>proxy[key](...args)]));
  });
}
export async function nativeDirectory(action,getPlugin=getNativeMedia){
  const plugin=await getPlugin();
  const status=await plugin[action]();
  if(action==='clear'||!status.selected) return null;
  return {
    // A lost Android grant is not re-promptable here; only explicit pick may
    // launch ACTION_OPEN_DOCUMENT_TREE.
    queryPermission:async()=> (await plugin.status()).granted?'granted':'denied',
    getFileHandle:async name=>({getFile:async()=>{
      const {base64,mime}=await plugin.read({name});
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
      return new Blob([bytes],{type:mime});
    }}),
  };
}
// Web-like backend kept private: browser globals and the public controller
// interface remain unchanged. Native completion events drive its existing flow.
export class NativeUtterance { constructor(text){this.text=text;this.rate=1;this.pitch=1;this.volume=1;} }
export function createNativeSynthesis(getPlugin=getNativeMedia){
  let voices=[],active=null,generation=0;
  const listeners=new Set();
  const refresh=async()=>{
    const plugin=await getPlugin();const result=await plugin.voices();voices=result.voices;
    for(const callback of listeners) callback();
    return result;
  };
  const initialized=getPlugin().then(async plugin=>{
    await plugin.addListener('voiceschanged',()=>refresh().catch(()=>{}));
    await plugin.addListener('tts',event=>{
      if(!active || !event.id || active.id!==event.id) return;
      const utter=active.utter;
      if(event.type!=='start') active=null;
      utter['on'+event.type]?.(event);
    });
    await refresh();return plugin;
  });
  initialized.catch(()=>{});
  return {
    getVoices:()=>voices,
    addEventListener:(type,callback)=>{if(type==='voiceschanged') listeners.add(callback);},
    cancel(){generation++;active=null;getPlugin().then(p=>p.cancel()).catch(()=>{});},
    speak(utter){
      const token=++generation;const id=`tts-${token}-${Date.now()}`;active={id,utter};
      initialized.then(async plugin=>{
        // Engine initialization is asynchronous; bounded retry, never speak a stale card.
        for(let i=0;i<30;i++) {
          if(token!==generation) return;
          const state=await plugin.voices();
          if(state.failed) throw Error('TTS engine unavailable');
          if(state.ready) break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        if(token!==generation) return;
        await plugin.speak({id,text:utter.text,rate:utter.rate,pitch:utter.pitch,volume:utter.volume,voice:utter.voice?.voiceURI||''});
      }).catch(error=>{if(token===generation){active=null;utter.onerror?.(error);}});
    },
    get speaking(){return !!active;},
  };
}
let synthesis;
export function nativeSynthesis(){return synthesis ||= createNativeSynthesis();}
