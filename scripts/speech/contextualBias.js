import { answerVariants } from '../app/vocabularyLearningCore.js';
import { buildRecognitionChunks } from './recognitionChunks.js';

export const VOCAB_WHOLE_BOOST = 8.0;
export const VOCAB_TARGET_CHUNK_BOOST = 7.0;
export const VOCAB_OVERLAP_BOOST = 6.0;
export const CLOZE_TARGET_CHUNK_BOOST = 7.0;
export const CLOZE_OVERLAP_BOOST = 6.0;
export const CLOZE_SENTENCE_CHUNK_BOOST = 5.0;
export const CORRECTION_WHOLE_BOOST = 8.0;
export const CORRECTION_TARGET_CHUNK_BOOST = 7.5;
export const RECOGNITION_PHRASE_LIMIT = 24;
export const LEARNING_MAX_ALTERNATIVES = 5;

export function normalizeRecognitionPhrase(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim()
    : '';
}

// This is decoding context only. Accepted utterances still come from strict TARGET variants.
export function buildRecognitionBiasContext({mode, referenceText, vocabularyEntry, activeOccurrence, clozeContext, correction=false}={}) {
  let candidates=[];
  const learning=mode==='vocabulary'||correction||(mode==='read'&&!!clozeContext);
  if(mode==='vocabulary') {
    for(const expected of answerVariants(vocabularyEntry,activeOccurrence)) candidates.push(...buildRecognitionChunks(expected,{
      includeWhole:true,wholeBoost:correction?CORRECTION_WHOLE_BOOST:VOCAB_WHOLE_BOOST,
      targetBoost:correction?CORRECTION_TARGET_CHUNK_BOOST:VOCAB_TARGET_CHUNK_BOOST,
      overlapBoost:correction?CORRECTION_TARGET_CHUNK_BOOST:VOCAB_OVERLAP_BOOST,
    }));
  } else if(correction) {
    candidates=buildRecognitionChunks(referenceText,{includeWhole:true,wholeBoost:CORRECTION_WHOLE_BOOST,targetBoost:CORRECTION_TARGET_CHUNK_BOOST,overlapBoost:CORRECTION_TARGET_CHUNK_BOOST});
  } else if(mode==='read'&&clozeContext) {
    candidates=buildRecognitionChunks(clozeContext.sentence,{
      targets:(Array.isArray(clozeContext.targets)?clozeContext.targets:[]).slice(0,3),
      targetBoost:CLOZE_TARGET_CHUNK_BOOST,overlapBoost:CLOZE_OVERLAP_BOOST,otherBoost:CLOZE_SENTENCE_CHUNK_BOOST,
    });
  }
  // Keep the strongest duplicate, then preserve insertion order for equal boosts.
  const unique=new Map();
  for(const candidate of candidates){
    const text=normalizeRecognitionPhrase(candidate.text),key=text.toLocaleLowerCase('en-US');
    if(!text||!/[A-Za-z]/.test(text)) continue;
    const previous=unique.get(key);
    if(!previous||candidate.boost>previous.boost) unique.set(key,{...candidate,text});
  }
  const phrases=[...unique.values()].sort((a,b)=>b.boost-a.boost).slice(0,RECOGNITION_PHRASE_LIMIT);
  return {phrases,maxAlternatives:learning?LEARNING_MAX_ALTERNATIVES:1};
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
