import { createRecognitionController } from '../../scripts/speech/recognition.js';
import { buildRecognitionBiasContext } from '../../scripts/speech/contextualBias.js';
import { buildRecognitionBiasContext as baselineContext } from './pr242ContextualBias.js';
import { classifyVocabularyAnswer } from '../../scripts/app/vocabularyLearningCore.js';
import { classifyVocabularySpeechAnswer } from '../../scripts/speech/vocabularySpeechEvidence.js';

const $=id=>document.getElementById(id);
const wrong={'yield to something':'want to do something',scarcely:'carefully',confuse:'refuse',"learn one's lesson":'forget the answer'};
const rows=[];
let controller,attempt,entry,activeOccurrence,finished=false;
const [data,items]=await Promise.all(['vocabulary-v3.json','items.json'].map(async name=>{
  const response=await fetch(`../../data/${name}`);if(!response.ok) throw Error(name);return response.json();
}));
const itemById=new Map(items.map(item=>[item.id,item]));
function selected(){
  const target=$('fixture').value;
  entry=data.entries.find(entry=>entry.canonical===target);
  if(!entry) throw Error(`Missing fixture: ${target}`);
  const occurrence=entry.occurrences[0];activeOccurrence={item:itemById.get(occurrence.item_id),occurrence};
  $('expected').textContent=$('probe').value==='correct'?target:wrong[target];
}
function record(result){
  if(finished||!attempt) return;finished=true;
  const primary=result?.previewTranscript||result?.transcript||controller?.getPreviewTranscript?.()||'';
  const grade=attempt.variant==='baseline'
    ? classifyVocabularyAnswer({entry,activeOccurrence,transcript:primary})
    : classifyVocabularySpeechAnswer({entry,activeOccurrence,transcript:primary,nativeSegments:result?.nativeSegments||[]});
  const kind=result?.technical||(!primary.trim()&&!result?.nativeSegments?.some(segment=>segment.alternatives.length))?'technical'
    : grade.type!=='target'?'miss':grade.targetRescued?'native-rescue':grade.recognitionAuthority==='filler-restart'?'primary-tolerated':'exact-primary';
  rows.push({...attempt,primary,kind,error:result?.technical||'',acceptedRank:grade.nativeRank??'',biasDisabled:attempt.biasCapability.unavailable});
  $('heard').textContent=primary;$('status').textContent=`記録：${kind}`;
  $('start').disabled=false;$('stop').disabled=true;$('export').disabled=false;
  for(const id of ['fixture','variant','probe']) $(id).disabled=false;
  $('summary').replaceChildren();
  const groups=new Map();
  for(const row of rows){const key=[row.variant,row.target,row.probe].join(' / ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  for(const [key,group] of groups){
    const values=['exact-primary','primary-tolerated','native-rescue','miss','technical'].map(kind=>group.filter(row=>row.kind===kind).length);
    const tr=document.createElement('tr');
    for(const value of [key,...values,`${Math.round(100*(values[0]+values[1]+values[2])/group.length)}% (${group.length}/10)`]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
    $('summary').append(tr);
  }
}
$('start').addEventListener('click',()=>{
  selected();finished=false;
  const variant=$('variant').value;
  const plan=(variant==='baseline'?baselineContext:buildRecognitionBiasContext)({mode:'vocabulary',vocabularyEntry:entry,activeOccurrence});
  const SR=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
  let phrasesProperty=false;
  try{phrasesProperty=!!SR&&'phrases' in new SR();}catch(_){}
  attempt={timestamp:new Date().toISOString(),variant,target:entry.canonical,probe:$('probe').value,intended:$('expected').textContent,userAgent:navigator.userAgent,secureContext:isSecureContext,phraseConstructor:typeof globalThis.SpeechRecognitionPhrase==='function',phrasesProperty,requestedAlternatives:plan.maxAlternatives||1,biasApplied:false,biasCapability:{unavailable:false}};
  $('heard').textContent='';$('start').disabled=true;$('stop').disabled=false;
  for(const id of ['fixture','variant','probe']) $(id).disabled=true;
  $('capabilities').textContent=JSON.stringify({android:/Android/.test(navigator.userAgent),secureContext:isSecureContext,phraseConstructor:attempt.phraseConstructor,phrasesProperty,requestedAlternatives:attempt.requestedAlternatives,phrases:plan.phrases},null,2);
  controller=createRecognitionController({shouldEvaluate:()=>false,getRecognitionBiasContext:()=>plan,biasCapability:attempt.biasCapability,onRecognitionConfigured:configuration=>{attempt.biasApplied=configuration.biasApplied;},onTranscriptPreview:text=>{$('heard').textContent=text;},onAutoStop:record,onError:event=>record({technical:event.error}),onUnsupported:()=>record({technical:'unsupported'})});
  $('status').textContent='録音中';controller.start();
});
$('stop').addEventListener('click',()=>record(controller.stop()));
for(const id of ['fixture','variant','probe']) $(id).addEventListener('change',selected);
$('export').addEventListener('click',()=>{
  const columns=['timestamp','variant','target','probe','intended','kind','error','primary','acceptedRank','requestedAlternatives','phraseConstructor','phrasesProperty','biasDisabled','biasApplied','secureContext','userAgent'];
  const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;
  const csv=[columns,...rows.map(row=>columns.map(column=>row[column]))].map(row=>row.map(quote).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='closed-set-android-results.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
selected();$('start').disabled=false;$('status').textContent='Android Chromeで測定してください';
