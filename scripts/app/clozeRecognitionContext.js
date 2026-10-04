let activeContext=null;
const copy=context=>context?{itemId:context.itemId,sentence:context.sentence,targets:context.targets.map(target=>({...target}))}:null;
export function setActiveClozeRecognitionContext(context) {
  activeContext=context&&typeof context.sentence==='string'&&Array.isArray(context.targets)
    ? copy(context):null;
}
export function getActiveClozeRecognitionContext(itemId) {
  return activeContext&&(itemId===undefined||String(itemId)===String(activeContext.itemId))?copy(activeContext):null;
}
export function clearActiveClozeRecognitionContext() { activeContext=null; }
