import { classifyVocabularySpeechAnswer } from '../speech/vocabularySpeechEvidence.js';
import { buildRecognitionBiasContext } from '../speech/contextualBias.js';
import { createCorrectionProgress, recordCorrectionAttempt } from '../speech/correctionProgress.js';
import { createLevelStateManager } from './levelState.js';
import { createRecognitionController, isRecognitionSupported } from '../speech/recognition.js';
import { nativeSpeechDiagnostic } from '../native/androidSpeechBackend.js';
import { isNativeAndroid } from '../native/runtimePlatform.js';
import { createSpeechSynthesisController } from '../speech/synthesis.js';
import {
  buildVocabularySession,
  applyVocabularyAnswerSrs,
  displayAnswer,
  displayMeaning,
  eligibleVocabularyEntries,
  joinVocabularyData,
  readyVocabularyEntries,
  vocabularyStats,
} from './vocabularyLearningCore.js';
import { migrateVocabularyProgress, migrateFinalAdmissionProgress } from './vocabularyMigration.js';
import { extractQuotedTurns, quotedTurnContainingSpan } from '../tagging/quotedTurns.js';
import { resolveSharedAudioUrl } from '../audio/resolver.js';

const state={
  entries:[],
  characters:[],
  kind:'all',
  queue:[],
  position:0,
  initialCount:0,
  completed:0,
  outcomes:new Map(),
  retried:new Set(),
  current:null,
  hintUsed:false,
  processing:false,
  timer:0,
  gradeTimer:0,
  liveTranscript:'',
  lastAttemptTranscript:'',
  correction:false,
  lastRecognitionDecision:null,
  correctionProgress:createCorrectionProgress(),
  audioGeneration:0,
  micGeneration:0,
  audioReleaseAt:0,
  recognition:null,
  dialog:null,
  screen:null,
  speechText:'',
  speechPromise:null,
  sourceAudioUrl:'',
  sourceAudio:null,
};
const RECENT_VOCAB_KEY='recentVocabularySessionIdsV1';
const VOCAB_ROTATION_KEY='vocabularyRotationSeedV1';

function loadRecentVocabularyIds(){
  try{
    const value=JSON.parse(localStorage.getItem(RECENT_VOCAB_KEY)||'[]');
    return Array.isArray(value)?[...new Set(value.map(String).filter(Boolean))].slice(0,30):[];
  }catch(_){ return []; }
}

function nextVocabularyRotationSeed(){
  let value=0;
  try{ value=Math.max(0,Number(localStorage.getItem(VOCAB_ROTATION_KEY))||0)+1;localStorage.setItem(VOCAB_ROTATION_KEY,String(value)); }catch(_){ value=Date.now(); }
  return value;
}

function rememberVocabularySession(entries){
  const ids=(Array.isArray(entries)?entries:[]).map(entry=>String(entry?.id||'')).filter(Boolean).slice(0,30);
  try{ localStorage.setItem(RECENT_VOCAB_KEY,JSON.stringify(ids)); }catch(_){}
}

const levels=createLevelStateManager({
  baseHintStage:0,
  getFirstHintStage:()=>1,
  getEnglishRevealStage:()=>1,
});

const speech=createSpeechSynthesisController({
  getCurrentItem:()=>state.speechText?{en:state.speechText}:null,
  isSpeechDesired:()=>!!state.speechText,
});
speech.setSpeechRate(0.94);

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function injectStyles(){
  if(document.getElementById('vocabModeStyles')) return;
  const style=document.createElement('style');
  style.id='vocabModeStyles';
  style.textContent=`
    #focusHomeNav.has-vocab-mode{grid-template-columns:repeat(3,1fr)}
    #focusHomeNav.has-vocab-mode button{min-width:0;font-size:13px;padding-inline:5px}
    .vocab-dialog{border:0;padding:0;background:transparent;color:inherit;width:min(100% - 10px,600px);max-height:calc(100dvh - 10px)}
    .vocab-dialog::backdrop{background:rgba(3,6,16,.82);backdrop-filter:blur(6px)}
    .vocab-shell{display:flex;flex-direction:column;height:min(720px,calc(100dvh - 10px));min-height:0;overflow:hidden;border:1px solid rgba(148,163,184,.16);border-radius:22px;background:#101522;box-shadow:0 24px 70px rgba(0,0,0,.5)}
    .vocab-head{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border-bottom:1px solid rgba(148,163,184,.1)}
    .vocab-head strong{font-size:17px}.vocab-close{width:44px;height:44px;min-width:44px;min-height:44px;border:0;border-radius:12px;background:rgba(148,163,184,.09);color:inherit;font:inherit;font-size:20px;cursor:pointer}
    .vocab-body{display:flex;flex:1;min-height:0;flex-direction:column;padding:15px;overflow:hidden}
    .vocab-lobby{display:flex;flex:1;min-height:0;flex-direction:column;justify-content:center;gap:16px;max-width:460px;width:100%;margin:auto;overflow:auto;padding:4px 1px}
    .vocab-lead{text-align:center}.vocab-lead h2{font-size:25px;margin:0 0 7px}.vocab-lead p{margin:0;opacity:.6;font-size:12px;line-height:1.55}
    .vocab-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.vocab-stat{min-width:0;padding:11px 6px;border:1px solid rgba(148,163,184,.12);border-radius:13px;text-align:center;background:rgba(148,163,184,.045)}.vocab-stat b{display:block;font-size:19px}.vocab-stat span{display:block;margin-top:1px;font-size:10px;opacity:.54;white-space:nowrap}
    .vocab-kind{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;padding:4px;border-radius:13px;background:rgba(148,163,184,.07)}.vocab-kind button{min-width:0;min-height:44px;border:0;background:transparent;color:inherit;border-radius:9px;padding:10px 4px;font:inherit;font-size:12px;cursor:pointer;opacity:.58;white-space:nowrap}.vocab-kind button.is-active{background:rgba(99,102,241,.22);opacity:1;font-weight:800}
    .vocab-start{min-height:54px;border:0;border-radius:15px;background:#6366f1;color:#fff;font:inherit;font-weight:850;font-size:16px;cursor:pointer;box-shadow:0 10px 24px rgba(99,102,241,.22)}.vocab-start:disabled{opacity:.45;cursor:default;box-shadow:none}
    .vocab-note{text-align:center;font-size:10px;line-height:1.45;opacity:.62}
    .vocab-study{display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden}.vocab-progress{display:flex;flex:0 0 auto;align-items:center;gap:9px;font-size:10px;opacity:.56;white-space:nowrap}.vocab-progress__bar{height:4px;flex:1;min-width:30px;border-radius:99px;background:rgba(148,163,184,.12);overflow:hidden}.vocab-progress__bar i{display:block;height:100%;background:currentColor;transition:width .2s ease}
    .vocab-card{display:flex;flex:1;min-height:0;overflow:auto;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:18px 8px 10px;scrollbar-width:thin}
    .vocab-meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;margin-bottom:13px}.vocab-meta span{display:inline-flex;align-items:center;min-height:22px;padding:3px 8px;border:1px solid rgba(148,163,184,.12);border-radius:999px;background:rgba(148,163,184,.045);font-size:9px;letter-spacing:.025em;opacity:.56;white-space:nowrap}
    .vocab-meaning{max-width:520px;font-size:clamp(24px,6.8vw,37px);font-weight:850;line-height:1.38;letter-spacing:.005em;line-break:strict;overflow-wrap:break-word}.vocab-meaning.is-long{font-size:clamp(21px,5.8vw,31px);line-height:1.45}.vocab-meaning.is-xlong{font-size:clamp(18px,5vw,27px);line-height:1.5}
    .vocab-prompt{margin-top:11px;font-size:11px;opacity:.42}.vocab-answer-wrap{display:flex;min-height:50px;margin-top:16px;flex-direction:column;align-items:center;justify-content:center;gap:7px;max-width:100%}.vocab-answer{max-width:520px;font-size:clamp(22px,5.8vw,32px);font-weight:850;line-height:1.35;color:#a5b4fc;word-break:normal;overflow-wrap:break-word;hyphens:auto}.vocab-answer.is-long{font-size:clamp(19px,5vw,27px)}.vocab-answer.is-xlong{font-size:clamp(17px,4.5vw,23px);line-height:1.42}.vocab-answer[hidden]{display:block!important;visibility:hidden}.vocab-audio{min-height:44px;border:1px solid rgba(165,180,252,.22);background:rgba(99,102,241,.08);color:#c7d2fe;border-radius:999px;padding:6px 11px;font:inherit;font-size:10px;font-weight:750;cursor:pointer}.vocab-audio[hidden]{display:none!important}
    .vocab-transcript{min-height:19px;width:100%;max-width:500px;margin-top:7px;font-size:12px;line-height:1.5;opacity:.72;white-space:normal;word-break:normal;overflow-wrap:anywhere}
    .vocab-heard{display:grid;gap:3px;width:min(100%,520px);margin:8px auto;text-align:center;line-height:1.45;overflow-wrap:anywhere}.vocab-heard__label{font-size:10px;opacity:.64}.vocab-heard__text{font-size:12px;opacity:.78;white-space:normal;word-break:normal;overflow-wrap:anywhere}
    .vocab-feedback{flex:0 0 auto;min-height:22px;text-align:center;font-size:12px;font-weight:750}.vocab-feedback.is-ok{color:#86efac}.vocab-feedback.is-paraphrase{color:#99f6e4}.vocab-feedback.is-miss{color:#fca5a5}.vocab-answer-detail,.vocab-paraphrases{margin:7px auto;text-align:center;font-size:12px;line-height:1.7;overflow-wrap:anywhere}.vocab-answer-detail{color:#99f6e4}.vocab-answer-detail strong{color:#e2e8f0}.vocab-paraphrases{opacity:.68}.vocab-paraphrases>span:first-child{font-size:10px;opacity:.8}
    .vocab-controls{display:flex;flex:0 0 auto;flex-direction:column;align-items:stretch;gap:7px;margin-top:6px}.vocab-mic{min-width:78px;width:auto;max-width:100%;padding-inline:12px;height:78px;align-self:center;border:0;border-radius:50%;background:#6366f1;color:#fff;font:inherit;font-size:14px;font-weight:850;cursor:pointer;box-shadow:0 12px 28px rgba(99,102,241,.28);transition:transform .12s ease,box-shadow .12s ease}.vocab-mic.is-listening{transform:scale(1.05);box-shadow:0 0 0 8px rgba(99,102,241,.14),0 12px 28px rgba(99,102,241,.28)}
    .vocab-reveal{min-height:44px;align-self:center;border:0;background:transparent;color:inherit;font:inherit;font-size:11px;opacity:.56;padding:7px 12px;cursor:pointer}
    .vocab-done{display:flex;flex:1;min-height:0;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:11px}.vocab-done h2{font-size:29px;margin:0}.vocab-done p{margin:0;opacity:.62}.vocab-done small{opacity:.48}.vocab-done button{min-width:210px;min-height:50px;border:0;border-radius:14px;background:#6366f1;color:white;font:inherit;font-weight:850;cursor:pointer;margin-top:7px}.vocab-done .vocab-reveal{min-width:44px;min-height:44px;background:transparent;color:inherit;margin-top:0}
    .vocab-speaker{display:inline-flex;align-items:center;gap:6px;min-height:32px;color:inherit;font-size:12px;font-weight:750;opacity:.84}.vocab-speaker img{width:32px;height:32px;flex:0 0 32px;border-radius:50%;object-fit:cover;background:rgba(148,163,184,.12)}.vocab-meta .vocab-speaker{min-height:32px;padding:0;border:0;background:transparent;font-size:12px;opacity:.9}.vocab-speaker-turns{display:grid;gap:6px;margin-top:10px}.vocab-speaker-turn{display:flex;align-items:center;gap:8px;padding:7px;border:1px solid rgba(148,163,184,.11);border-radius:11px;text-align:left}.vocab-context-state{gap:8px}.vocab-context-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 2px 4px}.vocab-context-top{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:10px;margin:2px 0 8px}.vocab-answer{max-width:100%;font-size:clamp(22px,5.8vw,32px);font-weight:850;line-height:1.35;color:#a5b4fc;overflow-wrap:anywhere}.vocab-source-line{margin:14px auto 8px;max-width:560px;font-size:clamp(16px,4.1vw,21px);line-height:1.65;text-align:center;overflow-wrap:anywhere}.vocab-target{color:#fff;background:rgba(99,102,241,.3);border-bottom:2px solid #a5b4fc;border-radius:3px;padding:0 2px}.vocab-contextual-meaning{margin:5px auto 12px;text-align:center;font-size:clamp(14px,3.8vw,17px);line-height:1.65;overflow-wrap:anywhere}.vocab-contextual-meaning span{display:block;font-size:10px;opacity:.55}.vocab-context-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}.vocab-expand-context{min-height:44px;padding:8px 14px;border:1px solid rgba(148,163,184,.16);border-radius:12px;background:rgba(148,163,184,.05);color:inherit;font:inherit;font-size:12px;cursor:pointer}.vocab-context-full{margin-top:12px;padding:11px 10px;border:1px solid rgba(148,163,184,.12);border-radius:13px;background:rgba(148,163,184,.035)}.vocab-context-full[hidden]{display:none}.vocab-context-full .vocab-source-line{margin:0 auto 9px;font-size:15px}.vocab-source-ja{margin:10px 0 2px;font-size:13px;line-height:1.6;opacity:.78;text-align:center;overflow-wrap:anywhere}.vocab-source-audio-status{min-height:17px;font-size:10px;text-align:center;opacity:.64}.vocab-next{width:100%;min-height:52px;border:0;border-radius:14px;background:#6366f1;color:#fff;font:inherit;font-size:15px;font-weight:850;cursor:pointer}.vocab-controls{padding-bottom:env(safe-area-inset-bottom)}.vocab-controls button,.vocab-context-actions button{touch-action:manipulation}.vocab-transcript:empty{display:none}.vocab-answer[hidden]{display:none!important}
    @media(max-width:390px){.vocab-body{padding:12px}.vocab-shell{border-radius:18px}.vocab-card{padding-inline:3px}.vocab-meta{margin-bottom:10px}.vocab-meaning{font-size:26px}.vocab-meaning.is-long{font-size:22px}.vocab-meaning.is-xlong{font-size:19px}.vocab-mic{min-width:72px;width:auto;max-width:100%;height:72px;padding-inline:12px}}
    @media(max-height:650px){.vocab-head{padding-block:9px}.vocab-body{padding-block:10px}.vocab-card{padding-block:10px 5px}.vocab-meta{margin-bottom:8px}.vocab-meaning{font-size:clamp(22px,6vw,31px)}.vocab-prompt{margin-top:7px}.vocab-answer-wrap{margin-top:10px}.vocab-mic{width:66px;height:66px}.vocab-controls{gap:4px;margin-top:3px}}
    @media(prefers-reduced-motion:reduce){.vocab-progress__bar i,.vocab-mic{transition:none!important}}
  `;
  document.head.appendChild(style);
}

async function loadVocabulary(){
  try{
    const load=async path=>{
      const res=await fetch(path,{cache:'no-cache'});
      if(!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.json();
    };
    const [vocabulary,items,characters,migration]=await Promise.all([
      load('./data/vocabulary-v3.json'),
      load('./data/items.json'),
      load('./data/characters.json'),
      load('./data/vocabulary-v2-v3-migration.json'),
    ]);
    migrateVocabularyProgress({migration});
    migrateFinalAdmissionProgress({migration});
    levels.refreshLevelState();
    state.characters=Array.isArray(characters)?characters:(Array.isArray(characters?.characters)?characters.characters:[]);
    return readyVocabularyEntries(joinVocabularyData(vocabulary,items,state.characters));
  }catch(error){
    console.warn('Vocabulary database failed to load',error);
    return [];
  }
}

function makeDialog(){
  if(state.dialog) return state.dialog;
  const dialog=document.createElement('dialog');
  dialog.id='vocabularyModeDialog';
  dialog.className='vocab-dialog';
  dialog.setAttribute('aria-labelledby','vocabModeTitle');
  dialog.innerHTML=`<section class="vocab-shell"><header class="vocab-head"><strong id="vocabModeTitle">単語・表現</strong><button type="button" class="vocab-close" aria-label="閉じる">×</button></header><div class="vocab-body" id="vocabModeScreen"></div></section>`;
  document.body.appendChild(dialog);
  state.dialog=dialog;
  state.screen=dialog.querySelector('#vocabModeScreen');
  dialog.querySelector('.vocab-close').addEventListener('click',closeDialog);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  dialog.addEventListener('click',event=>{if(event.target===dialog) closeDialog();});
  return dialog;
}

function clearGradeTimer(){
  clearTimeout(state.gradeTimer);
  state.gradeTimer=0;
}

function cancelPronunciation(){
  state.audioGeneration+=1;
  state.speechText='';
  state.speechPromise=null;
  speech.cancelSpeech();
}

function stopListening(){
  state.micGeneration+=1;
  clearTimeout(state.timer);
  state.timer=0;
  clearGradeTimer();
  if(state.recognition?.isActive?.()) state.recognition.cancel();
}

function closeDialog(){
  stopListening();
  cancelPronunciation();
  state.processing=false;
  state.queue=[];
  state.current=null;
  state.sourceAudio?.pause?.();
  state.sourceAudio=null;
  if(state.dialog?.open) state.dialog.close();
}

function renderLobby(){
  stopListening();
  cancelPronunciation();
  state.processing=false;
  levels.refreshLevelState();
  const levelState=JSON.parse(localStorage.getItem('itemLevelV1')||'{}');
  const eligible=eligibleVocabularyEntries(state.entries,levelState);
  const entries=state.kind==='all'?eligible:eligible.filter(x=>state.kind==='word'
    ?x.kind==='word':x.kind==='expression'||x.kind==='construction');
  const stats=vocabularyStats(entries,levelState);
  const plan=buildVocabularySession(entries,levelState,{size:12,kind:'all'});
  const speechSupported=isRecognitionSupported();
  state.screen.innerHTML=`
    <section class="vocab-lobby">
      <div class="vocab-lead"><h2>日本語 → 英語</h2><p>会話で出会った単語・表現を思い出します。意味を見て、英語を声に出して答えます。</p></div>
      <div class="vocab-stats">
        <div class="vocab-stat"><b>${stats.due}</b><span>復習</span></div>
        <div class="vocab-stat"><b>${stats.fresh}</b><span>未学習</span></div>
        <div class="vocab-stat"><b>${stats.total}</b><span>対象</span></div>
      </div>
      <div class="vocab-kind" role="group" aria-label="カード種別">
        <button type="button" data-kind="all" aria-pressed="${state.kind==='all'}" class="${state.kind==='all'?'is-active':''}">すべて</button>
        <button type="button" data-kind="word" aria-pressed="${state.kind==='word'}" class="${state.kind==='word'?'is-active':''}">単語</button>
        <button type="button" data-kind="expression" aria-pressed="${state.kind==='expression'}" class="${state.kind==='expression'?'is-active':''}">表現</button>
      </div>
      <button type="button" class="vocab-start" ${plan.size&&speechSupported?'':'disabled'}>${!speechSupported?'音声認識を利用できません':plan.size?`${plan.size}枚で始める`:'対象カードなし'}</button>
      <div class="vocab-note">${!speechSupported?'音声認識に対応していないため、このモードは利用できません。':stats.total?'答えを見ると要復習として記録されます。':'会話学習を進めると、出会った単語・表現がここに追加されます。'}</div>
    </section>`;
  state.screen.querySelectorAll('[data-kind]').forEach(button=>button.addEventListener('click',()=>{
    state.kind=button.dataset.kind||'all';
    renderLobby();
  }));
  state.screen.querySelector('.vocab-start')?.addEventListener('click',startSession);
}

function openVocabularyMode(){
  if(!state.entries.length) return false;
  makeDialog();
  renderLobby();
  if(!state.dialog.open) state.dialog.showModal();
  return true;
}

function startSession(){
  if(!isRecognitionSupported()) return;
  stopListening();
  cancelPronunciation();
  const levelState=JSON.parse(localStorage.getItem('itemLevelV1')||'{}');
  const eligible=eligibleVocabularyEntries(state.entries,levelState);
  const plan=buildVocabularySession(eligible,levelState,{
    size:12,
    kind:state.kind,
    recentItemIds:loadRecentVocabularyIds(),
    rotationSeed:nextVocabularyRotationSeed(),
  });
  rememberVocabularySession(plan.entries);
  state.queue=plan.entries.slice();
  state.position=0;
  state.initialCount=plan.size;
  state.completed=0;
  state.outcomes=new Map();
  state.retried=new Set();
  state.liveTranscript='';
  state.lastAttemptTranscript='';
  state.lastRecognitionDecision=null;
  state.correction=false;
  showNextCard();
}

function latestNonEmptyTranscript(...values){
  for(const value of values){
    const text=String(value??'');
    if(text.trim()) return text;
  }
  return '';
}

function hasNativeSpeech(){
  return state.recognition?.getNativeRecognitionSegments?.().some(segment=>segment.alternatives.some(candidate=>candidate.transcript.trim()));
}

function scheduleTranscriptGrade(text){
  if(state.processing||!state.current) return;
  state.liveTranscript=String(text??'');
  setTranscript(state.liveTranscript);
  clearGradeTimer();
  // Native previews are display-only; wait for the terminal result/error.
  if(isNativeAndroid()) return;
  if(!state.liveTranscript.trim()&&!hasNativeSpeech()) return;
  const delay=state.current.kind==='word'?650:1200;
  state.gradeTimer=setTimeout(()=>{
    state.gradeTimer=0;
    const latest=latestNonEmptyTranscript(state.liveTranscript,state.recognition?.getPreviewTranscript?.());
    if(!state.processing&&state.current) gradeTranscript(latest);
  },delay);
}

function showRecognitionStatus(message){
  const prompt=state.screen?.querySelector('.vocab-prompt');
  if(prompt) prompt.textContent=message;
}

function showRecognitionFailure(){
  if(state.correction&&!state.processing){
    const result=recordCorrectionAttempt(state.correctionProgress,{technical:true});
    const feedback=state.screen?.querySelector('.vocab-feedback');
    if(feedback) feedback.textContent=result.message;
    clearGradeTimer();setListening(false);
    if(result.complete) completeCorrectionPractice();
    else showRecognitionStatus('マイクを押してもう一度話してください。');
    return;
  }
  clearGradeTimer();
  setListening(false);
  const feedback=state.screen?.querySelector('.vocab-feedback');
  if(feedback){feedback.className='vocab-feedback';feedback.textContent='認識できませんでした。もう一度。';}
  showRecognitionStatus('マイクを押してもう一度話してください。');
}

function setupRecognition(){
  state.recognition=createRecognitionController({
    // Bias strict TARGET utterances; native evidence never rewrites raw primary text.
    getRecognitionBiasContext:()=>buildRecognitionBiasContext({mode:'vocabulary',vocabularyEntry:state.current,activeOccurrence:activeSource(),correction:state.correction}),
    shouldEvaluate:()=>false,
    onTranscriptReset:()=>{clearGradeTimer();state.liveTranscript='';state.lastAttemptTranscript='';setTranscript('');},
    onTranscriptPreview:text=>{
      if(state.processing||!state.current) return;
      scheduleTranscriptGrade(text);
    },
    onAutoStop:result=>{
      if(state.processing||!state.current) return;
      clearGradeTimer();
      const text=latestNonEmptyTranscript(result?.previewTranscript,state.liveTranscript,result?.transcript);
      if(text||hasNativeSpeech()){state.liveTranscript=text;setTranscript(text);gradeTranscript(text);}
      else showRecognitionFailure();
    },
    onUnsupported:()=>{
      setListening(false);
      showRecognitionStatus('音声認識に対応していないため、このモードは利用できません。');
    },
    onError:()=>showRecognitionFailure(),
    setMicState:setListening,
  });
}

function setListening(active){
  const mic=state.screen?.querySelector('.vocab-mic');
  if(!mic) return;
  mic.classList.toggle('is-listening',!!active);
  mic.textContent=active?'停止':'話す';
  mic.setAttribute('aria-label',active?'音声認識を停止':'音声認識を開始');
}

function setTranscript(text){
  const el=state.screen?.querySelector('.vocab-transcript');
  if(el) el.textContent=String(text||'');
}

async function startListening(){
  if(!state.current||state.processing||!state.recognition) return;
  clearTimeout(state.timer);
  state.timer=0;
  if(state.recognition.isActive()){
    const generation=state.micGeneration;
    const current=state.current;
    const result=await state.recognition.stop();
    if(generation!==state.micGeneration||current!==state.current||!result?.ok) return;
    clearGradeTimer();
    const text=latestNonEmptyTranscript(result?.previewTranscript,state.liveTranscript,result?.transcript);
    if((text||hasNativeSpeech())&&!state.processing) gradeTranscript(text);
    else if(!state.processing) showRecognitionFailure();
    return;
  }
  const token=++state.micGeneration;
  const current=state.current;
  const pendingAudio=state.speechPromise;
  if(pendingAudio) await pendingAudio;
  if(state.sourceAudio){state.sourceAudio.pause?.();state.audioReleaseAt=Date.now()+800;}
  if(speech.isSpeaking?.()) return;
  const delay=Math.max(350,state.audioReleaseAt-Date.now());
  await new Promise(resolve=>setTimeout(resolve,delay));
  if(token!==state.micGeneration||current!==state.current||state.processing) return;
  const feedback=state.screen?.querySelector('.vocab-feedback');
  if(feedback){feedback.className='vocab-feedback';feedback.textContent='';}
  showRecognitionStatus(state.correction?'表示された表現を話してください':'英語で答える');
  const result=state.recognition.start();
  if(!result?.ok) setListening(false);
}

function updateVocabularyLevel(answerType,hintUsed){
  const application=applyVocabularyAnswerSrs(answerType,rate=>{
    const evaluation=levels.evaluateLevel(rate,hintUsed?1:0);
    return levels.updateLevelInfo(state.current.id,evaluation);
  });
  return application.value??null;
}

function densityClass(base,text,{long=24,xlong=42}={}){
  const length=[...String(text||'')].length;
  if(length>=xlong) return `${base} is-xlong`;
  if(length>=long) return `${base} is-long`;
  return base;
}

function sectionLabel(entry){
  const raw=String(entry?.section??'').trim().replace(/^section\s*/i,'');
  return /^\d+$/.test(raw)?`Sec. ${Number(raw)}`:'';
}

function canonicalAnswer(){
  return displayAnswer(state.current);
}

function setAnswerVisible(text=canonicalAnswer()){
  const answer=state.screen?.querySelector('.vocab-answer');
  if(!answer) return;
  answer.hidden=false;
  answer.textContent=text;
  answer.className=densityClass('vocab-answer',text,{long:22,xlong:38});
  const audio=state.screen.querySelector('.vocab-audio');
  if(audio) audio.hidden=!speech.supported();
}

function speakAnswer(text=canonicalAnswer()){
  const value=String(text||'').trim();
  if(!value||!speech.supported()){
    state.speechPromise=Promise.resolve(false);
    return state.speechPromise;
  }
  stopListening();
  const generation=++state.audioGeneration;
  const current=state.current,position=state.position;
  state.sourceAudio?.pause?.();
  state.speechText=value;
  let tracked;
  tracked=Promise.resolve(speech.speakCurrentCard())
    .catch(()=>false)
    .finally(()=>{
      if(state.speechPromise===tracked) state.speechPromise=null;
      if(generation===state.audioGeneration){
        state.audioReleaseAt=Date.now()+800;
        if(state.current===current&&state.position===position&&state.processing&&!state.correction) scheduleVocabularyAdvance();
      }
    });
  state.speechPromise=tracked;
  return tracked;
}

function bindPronunciationButton(){
  const button=state.screen?.querySelector('.vocab-expression-audio');
  if(!button||button.dataset.boundPronunciation==='true') return;
  button.dataset.boundPronunciation='true';
  button.addEventListener('click',()=>speakAnswer());
}

function activeSource(){
  const active=state.current?.activeOccurrence;
  return active?.item&&active?.occurrence?active:null;
}

function speakerProfile(item,turnIndex=null){
  const tags=Array.isArray(item?.speaker_tags)?item.speaker_tags:[];
  let id='';
  if(tags.length===1) id=String(tags[0]?.id||'');
  else if(tags.length===2&&Number.isInteger(turnIndex)&&turnIndex>=0) id=String(tags[turnIndex%2]?.id||'');
  return state.characters.find(profile=>String(profile?.id)===id)||null;
}

function speakerCue(profile){
  if(!profile?.name) return '';
  return `<span class="vocab-speaker"><img src="./${encodeURIComponent(profile.name)}.png" alt=""><span lang="ja">${escapeHtml(profile.name)}</span></span>`;
}

function bindSpeakerImageFallback(root=state.screen){
  root?.querySelectorAll('.vocab-speaker img').forEach(image=>image.addEventListener('error',()=>{image.hidden=true;}));
}

function sourceSegment(item,occurrence,{full=false}={}){
  const source=String(item?.en||'');
  const start=Number(occurrence?.start),end=Number(occurrence?.end);
  const turn=full?null:quotedTurnContainingSpan(source,start,end);
  const segmentStart=turn?.contentStart??0;
  const segmentEnd=turn?.contentEnd??source.length;
  const safeStart=Math.max(segmentStart,Math.min(segmentEnd,start));
  const safeEnd=Math.max(safeStart,Math.min(segmentEnd,end));
  return `${escapeHtml(source.slice(segmentStart,safeStart))}<mark class="vocab-target">${escapeHtml(source.slice(safeStart,safeEnd))}</mark>${escapeHtml(source.slice(safeEnd,segmentEnd))}`;
}

function fullSpeakerContext(item){
  const turns=extractQuotedTurns(item?.en||'');
  if(turns.length){
    return `<div class="vocab-speaker-turns">${turns.map(turn=>{
      const profile=speakerProfile(item,turn.index);
      return `<div class="vocab-speaker-turn">${speakerCue(profile)}<span lang="en">“${escapeHtml(turn.text)}”</span></div>`;
    }).join('')}</div>`;
  }
  return speakerCue(speakerProfile(item));
}

function bindSourceAudio(){
  const button=state.screen?.querySelector('.vocab-source-audio');
  const active=activeSource();
  const item=active?.item;
  if(!button||!item?.audio_fn) return;
  const expected=state.current;
  resolveSharedAudioUrl(item.audio_fn).then(url=>{
    if(!url||state.current!==expected||!state.screen?.contains(button)) return;
    state.sourceAudioUrl=url;
    button.hidden=false;
  }).catch(()=>{});
  button.addEventListener('click',async()=>{
    if(!state.sourceAudioUrl) return;
    stopListening();
    cancelPronunciation();
    state.sourceAudio?.pause?.();
    state.audioReleaseAt=Date.now()+800;
    const audio=new Audio(state.sourceAudioUrl);
    state.sourceAudio=audio;
    audio.onended=()=>{if(state.current===expected&&state.sourceAudio===audio&&state.processing&&!state.correction) scheduleVocabularyAdvance();};
    try{await audio.play();}catch(_){
      const status=state.screen?.querySelector('.vocab-source-audio-status');
      if(status) status.textContent='この例文音声を再生できませんでした。';
    }
  });
}

function revealFullContext(){
  const active=activeSource();
  const item=active?.item;
  if(!item) return;
  const host=state.screen?.querySelector('.vocab-context-full');
  const button=state.screen?.querySelector('.vocab-expand-context');
  if(!host||!button) return;
  if(button.dataset.expanded==='true'){
    host.hidden=true;button.dataset.expanded='false';button.textContent='前後を見る';button.setAttribute('aria-expanded','false');return;
  }
  host.innerHTML=`<p class="vocab-source-line" lang="en" dir="ltr">${sourceSegment(item,active.occurrence,{full:true})}</p>${fullSpeakerContext(item)}<p class="vocab-source-ja" lang="ja">${escapeHtml(item.ja||'')}</p>`;
  host.hidden=false;button.dataset.expanded='true';button.textContent='前後を閉じる';button.setAttribute('aria-expanded','true');
  bindSpeakerImageFallback(host);
}

function nextButton(){
  const button=document.createElement('button');
  button.type='button';button.className='vocab-next';button.textContent='次へ';
  button.addEventListener('click',()=>{state.position+=1;showNextCard();});
  return button;
}

function completeCorrectionPractice(){
  state.correction=false;
  state.processing=true;
  clearGradeTimer();
  setListening(false);
  const prompt=state.screen?.querySelector('.vocab-prompt');
  if(prompt) prompt.textContent='修正練習完了';
  const controls=state.screen?.querySelector('.vocab-controls');
  if(controls){
    controls.replaceChildren(nextButton());
    controls.querySelector('.vocab-next')?.focus({preventScroll:true});
  }
  scheduleVocabularyAdvance();
}

function heardTranscriptMarkup(text){
  const raw=String(text??'');
  if(!raw.trim()) return '';
  return `<div class="vocab-heard"><span class="vocab-heard__label" id="vocabHeardLabel">聞き取り</span><span class="vocab-heard__text" lang="en" dir="ltr" aria-labelledby="vocabHeardLabel">${escapeHtml(raw)}</span></div>`;
}

function renderAnswerContext({result=null,heardTranscript=state.lastAttemptTranscript}={}){
  stopListening();
  state.sourceAudio?.pause?.();state.sourceAudio=null;state.sourceAudioUrl='';
  const active=activeSource();
  if(!active) return;
  const {item,occurrence}=active;
  const speaker=active.sourceSpeaker?.profile||null;
  const answer=canonicalAnswer();
  const resultType=result?.type||null;
  const feedbackText=resultType==='target'?'正解':resultType==='paraphrase'?'意味はOK':resultType==='miss'?'あとでもう一度':'';
  const feedbackClass=resultType==='target'?'is-ok':resultType==='paraphrase'?'is-paraphrase':resultType==='miss'?'is-miss':'';
  const resultDetails=resultType==='paraphrase'
    ?`<div class="vocab-answer-detail" lang="ja">このカードの表現：<strong lang="en">${escapeHtml(answer)}</strong><br>別の言い方：<strong lang="en">${escapeHtml(result.matchedText||'')}</strong></div>`
    :'';
  const paraphraseList=Array.isArray(state.current?.paraphrases)?state.current.paraphrases:[];
  const paraphraseMarkup=paraphraseList.length
    ?`<div class="vocab-paraphrases"><span>別の言い方：</span>${paraphraseList.map(value=>`<span lang="en">${escapeHtml(value)}</span>`).join('、 ')}</div>`
    :'';
  state.screen.innerHTML=`
    <section class="vocab-study vocab-context-state">
      <div class="vocab-context-scroll">
        ${heardTranscriptMarkup(heardTranscript)}
        <div class="vocab-context-top"><div class="vocab-answer" lang="en" dir="ltr" tabindex="-1">${escapeHtml(answer)}</div>${speakerCue(speaker)}</div>
        <button type="button" class="vocab-audio vocab-expression-audio" aria-label="英語の表現を再生" ${speech.supported()?'':'hidden'}>表現を聞く</button>
        <p class="vocab-source-line" lang="en" dir="ltr">${sourceSegment(item,occurrence)}</p>
        <p class="vocab-contextual-meaning" lang="ja"><span>この文では：</span>${escapeHtml(occurrence.contextual_meaning_ja)}</p>
        <div class="vocab-context-actions">
          <button type="button" class="vocab-audio vocab-source-audio" aria-label="例文の音声を再生" hidden>例文音声</button>
          <button type="button" class="vocab-expand-context" aria-expanded="false">前後を見る</button>
        </div>
        <div class="vocab-source-audio-status" aria-live="polite"></div>
        <div class="vocab-context-full" hidden></div>
        ${resultDetails}${paraphraseMarkup}
        ${state.correction?'<div class="vocab-prompt" role="status">正解音声を聞いて、表示された表現を話してください</div><div class="vocab-transcript" lang="en" aria-label="修正練習の聞き取り" aria-live="off"></div>':''}
        <div class="vocab-feedback ${feedbackClass}" role="status" aria-live="polite" aria-atomic="true">${feedbackText}</div>
      </div>
      <div class="vocab-controls"></div>
    </section>`;
  bindSpeakerImageFallback();
  bindPronunciationButton();
  bindSourceAudio();
  state.screen.querySelector('.vocab-expand-context')?.addEventListener('click',revealFullContext);
  const controls=state.screen.querySelector('.vocab-controls');
  if(state.correction){
    controls.innerHTML='<button type="button" class="vocab-mic" aria-label="表示された表現を話す">話す</button>';
    controls.querySelector('.vocab-mic').addEventListener('click',startListening);
    const audioButton=state.screen.querySelector('.vocab-expression-audio');
    (audioButton&&!audioButton.hidden?audioButton:controls.querySelector('.vocab-mic'))?.focus({preventScroll:true});
    state.processing=false;
    setupRecognition();
  }else{
    controls.appendChild(nextButton());
    controls.querySelector('.vocab-next').focus({preventScroll:true});
  }
  if(result!==null) speakAnswer(answer);
  if(!state.correction) scheduleVocabularyAdvance();
}

function gradeTranscript(text){
  if(state.processing||!state.current) return;
  const transcript=String(text??'');
  if(!transcript.trim()&&!hasNativeSpeech()) return;
  state.processing=true;
  clearGradeTimer();
  state.liveTranscript=transcript;
  state.lastAttemptTranscript=transcript;
  setTranscript(transcript);
  const result=classifyVocabularySpeechAnswer({entry:state.current,activeOccurrence:activeSource(),transcript,nativeSegments:state.recognition?.getNativeRecognitionSegments?.()||[],correction:state.correction});
  state.lastRecognitionDecision=result;
  nativeSpeechDiagnostic('grading',{mode:'vocabulary',entryId:state.current.id,decision:result});
  if(state.recognition?.isActive()) state.recognition.cancel();
  setListening(false);
  if(state.correction){
    const feedback=state.screen.querySelector('.vocab-feedback');
    const progress=recordCorrectionAttempt(state.correctionProgress,{success:result.type==='target'});
    if(feedback){feedback.className=result.type==='target'?'vocab-feedback is-ok':'vocab-feedback';feedback.textContent=progress.message;}
    if(progress.complete) completeCorrectionPractice();
    else state.processing=false;
    return;
  }
  if(result.type==='miss'){renderTranscriptReview();return;}
  finalizeVocabularyAnswer(result);
}

function scheduleVocabularyAdvance(){
  clearTimeout(state.timer);
  const current=state.current,position=state.position;
  state.timer=setTimeout(()=>{
    state.timer=0;
    if(state.current!==current||state.position!==position||!state.processing) return;
    state.position+=1;showNextCard();
  },1900);
}

function renderTranscriptReview(){
  stopListening();
  state.screen.querySelector('.vocab-heard')?.remove();
  const live=state.screen.querySelector('.vocab-transcript');
  live?.insertAdjacentHTML('beforebegin',heardTranscriptMarkup(state.lastAttemptTranscript));
  setTranscript('');
  const feedback=state.screen.querySelector('.vocab-feedback');
  if(feedback) feedback.textContent='聞き取りを確認して、もう一度話してください。';
  const mic=state.screen.querySelector('.vocab-mic');
  if(mic){mic.textContent='もう一度話す';mic.setAttribute('aria-label','もう一度話す');mic.focus({preventScroll:true});}
  state.processing=false;
}

function finalizeVocabularyAnswer(result){
  if(!state.current) return;
  state.processing=true;
  state.correction=result.type==='miss';
  state.correctionProgress=createCorrectionProgress();
  updateVocabularyLevel(result.type,state.hintUsed);
  state.outcomes.set(state.current.id,result.type);
  if(result.type==='miss'&&!state.retried.has(state.current.id)){
    state.retried.add(state.current.id);
    state.queue.push(state.current);
  }
  state.completed+=1;
  renderAnswerContext({result,heardTranscript:state.lastAttemptTranscript});
}

function revealAnswer(){
  if(state.processing||!state.current||state.correction) return;
  state.processing=true;
  state.hintUsed=true;
  const transcript=latestNonEmptyTranscript(
    state.recognition?.getPreviewTranscript?.(),
    state.liveTranscript,
    state.lastAttemptTranscript,
  );
  clearGradeTimer();
  stopListening();
  setListening(false);
  state.lastAttemptTranscript=transcript;
  state.liveTranscript=transcript;
  finalizeVocabularyAnswer({type:'miss',matchedText:'',matchedAuthority:null});
}

function showNextCard(){
  clearTimeout(state.timer);
  clearGradeTimer();
  cancelPronunciation();
  state.timer=0;
  state.liveTranscript='';
  state.lastAttemptTranscript='';
  state.lastRecognitionDecision=null;
  state.correction=false;
  state.sourceAudio?.pause?.();state.sourceAudio=null;state.sourceAudioUrl='';
  if(state.position>=state.queue.length){ renderDone(); return; }
  state.current=state.queue[state.position];
  state.hintUsed=false;
  state.processing=false;
  const meaning=displayMeaning(state.current);
  const kindLabel=state.current.kind==='word'?'単語':'表現';
  const speaker=state.current.activeOccurrence?.sourceSpeaker?.profile||null;
  state.screen.innerHTML=`
    <section class="vocab-study">
      <div class="vocab-card">
        <div class="vocab-meta">${speakerCue(speaker)}<span>${kindLabel}</span></div>
        <div class="${densityClass('vocab-meaning',meaning,{long:20,xlong:34})}" lang="ja">${escapeHtml(meaning)}</div>
        <div class="vocab-prompt">英語で答える</div>
        <div class="vocab-transcript" lang="en" dir="ltr" aria-label="音声認識中の全文" aria-live="off"></div>
        <div class="vocab-feedback" role="status" aria-live="polite" aria-atomic="true"></div>
      </div>
      <div class="vocab-controls">
        <button type="button" class="vocab-mic" aria-label="英語で答える">話す</button>
        <button type="button" class="vocab-reveal">答えを見る</button>
      </div>
    </section>`;
  bindSpeakerImageFallback();
  setupRecognition();
  state.screen.querySelector('.vocab-mic')?.addEventListener('click',startListening);
  state.screen.querySelector('.vocab-reveal')?.addEventListener('click',revealAnswer);
  state.screen.querySelector('.vocab-mic')?.focus({preventScroll:true});
  if(isRecognitionSupported()) state.timer=setTimeout(startListening,550);
}

function renderDone(){
  stopListening();
  cancelPronunciation();
  state.current=null;
  state.processing=false;
  state.sourceAudio?.pause?.();state.sourceAudio=null;state.sourceAudioUrl='';
  const initial=Math.max(0,state.initialCount);
  const retryCount=state.retried.size;
  const outcomes=[...state.outcomes.values()];
  const targetCount=outcomes.filter(type=>type==='target').length;
  const paraphraseCount=outcomes.filter(type=>type==='paraphrase').length;
  const missCount=outcomes.filter(type=>type==='miss').length;
  state.screen.innerHTML=`<section class="vocab-done"><h2>完了</h2><p>ターゲット正解 ${targetCount}　別表現 ${paraphraseCount}　要復習 ${missCount}</p><small>対象 ${initial}枚</small>${retryCount?`<small>再確認 ${retryCount}枚</small>`:''}<button type="button">もう1セット</button><button type="button" class="vocab-reveal" data-back>戻る</button></section>`;
  state.screen.querySelector('.vocab-done>button:not([data-back])')?.addEventListener('click',renderLobby);
  state.screen.querySelector('[data-back]')?.addEventListener('click',renderLobby);
}

async function waitForHomeNav(timeout=10000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    const nav=document.getElementById('focusHomeNav');
    if(nav) return nav;
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  return null;
}

async function init(){
  injectStyles();
  const [entries,nav]=await Promise.all([loadVocabulary(),waitForHomeNav()]);
  state.entries=entries;
  globalThis.__OPEN_VOCABULARY_MODE__=openVocabularyMode;
  if(!nav||!entries.length) return;
  if(document.getElementById('openVocabularyMode')) return;
  nav.classList.add('has-vocab-mode');
  const button=document.createElement('button');
  button.type='button';
  button.id='openVocabularyMode';
  button.textContent='単語・表現';
  button.addEventListener('click',openVocabularyMode);
  nav.appendChild(button);
  makeDialog();
}

if(typeof document!=='undefined') init().catch(error=>console.warn('Vocabulary mode failed to initialize',error));
