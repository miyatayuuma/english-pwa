import { spanify } from '../utils/text.js';

export const POST_RESULT_REVEAL_DATASET_KEY='postResultReveal';

export function isPostResultReveal(enElement,itemId=''){
  if(!enElement?.dataset) return false;
  const revealed=String(enElement.dataset[POST_RESULT_REVEAL_DATASET_KEY]||'');
  return !!revealed&&(!itemId||revealed===String(itemId));
}

export function clearPostResultReveal(enElement){
  if(!enElement?.dataset) return;
  delete enElement.dataset[POST_RESULT_REVEAL_DATASET_KEY];
}

export function revealCanonicalPostResult(enElement,item,{rehighlight}={}){
  const itemId=String(item?.id||'');
  const canonical=String(item?.en||'').trim();
  if(!enElement||!itemId||!canonical) return null;
  enElement.dataset[POST_RESULT_REVEAL_DATASET_KEY]=itemId;
  enElement.classList?.remove?.('concealed','cloze-active');
  enElement.innerHTML=spanify(canonical);
  return typeof rehighlight==='function'?rehighlight(canonical):null;
}
