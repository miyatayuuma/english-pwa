import { answerVariants } from '../app/vocabularyLearningCore.js';
import { sentenceTokens } from '../app/clozeLearningCore.js';

export const VOCAB_TARGET_BOOST = 4.0;
export const CLOZE_TARGET_BOOST = 4.5;
export const CLOZE_LOCAL_BOOST = 3.0;
export const CORRECTION_TARGET_BOOST = 5.0;
export const RECOGNITION_PHRASE_LIMIT = 16;

export function normalizeRecognitionPhrase(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim()
    : '';
}

// Context helps decoding; it never changes the transcript or grading authority.
export function buildRecognitionBiasContext({mode, referenceText, vocabularyEntry, activeOccurrence, clozeContext, correction=false}={}) {
  const phrases=[];
  const seen=new Set();
  const add=(value,boost,authority)=>{
    const text=normalizeRecognitionPhrase(value);
    const key=text.toLocaleLowerCase('en-US');
    if(!text||!/[A-Za-z]/.test(text)||seen.has(key)||phrases.length>=RECOGNITION_PHRASE_LIMIT) return;
    seen.add(key);phrases.push({text,boost,authority});
  };
  if(mode==='vocabulary') {
    for(const text of answerVariants(vocabularyEntry,activeOccurrence))
      add(text,correction?CORRECTION_TARGET_BOOST:VOCAB_TARGET_BOOST,'vocabulary-target');
  } else if(correction) {
    add(referenceText,CORRECTION_TARGET_BOOST,'correction-target');
  } else if(mode==='read'&&clozeContext) {
    const tokens=sentenceTokens(clozeContext.sentence);
    const targets=(Array.isArray(clozeContext.targets)?clozeContext.targets:[]).slice(0,3).filter(target=>target&&
      Number.isInteger(target.tokenStart)&&Number.isInteger(target.tokenEnd)&&
      target.tokenStart>=0&&target.tokenEnd>=target.tokenStart&&target.tokenEnd<tokens.length);
    for(const target of targets) add(target.surface,CLOZE_TARGET_BOOST,'cloze-target');
    for(const target of targets) {
      const start=Math.max(0,target.tokenStart-2),end=Math.min(tokens.length-1,target.tokenEnd+2);
      add(clozeContext.sentence.slice(tokens[start].start,tokens[end].end),CLOZE_LOCAL_BOOST,'cloze-local');
    }
  }
  return {phrases};
}

export function applyRecognitionBias(recognition,context,scope=globalThis) {
  if(!recognition||!('phrases' in recognition)||typeof scope.SpeechRecognitionPhrase!=='function') return false;
  const phrases=context?.phrases||[];
  if(!phrases.length) return false;
  try {
    recognition.phrases=phrases.map(({text,boost})=>new scope.SpeechRecognitionPhrase(text,boost));
    return true;
  } catch (_) { return false; }
}
