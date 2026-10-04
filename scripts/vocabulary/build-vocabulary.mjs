import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const posTagger=require('wink-pos-tagger');
const tagger=posTagger();

const ROOT=process.cwd();
const ITEMS_PATH=path.join(ROOT,'data/items.json');
const OUT_PATH=path.join(ROOT,'data/vocabulary.json');
const REPORT_PATH=path.join(ROOT,'data/vocabulary-report.json');
const EJDICT_DIR=process.env.EJDICT_DIR || path.join(ROOT,'.tmp','EJDict','src');

const STOPWORDS=new Set([
  'a','an','the','this','that','these','those','i','me','my','mine','we','us','our','ours','you','your','yours','he','him','his','she','her','hers','it','its','they','them','their','theirs',
  'who','whom','whose','which','what','where','when','why','how','someone','somebody','something','anyone','anybody','anything','everyone','everybody','everything',
  'am','be','is','are','was','were','been','being','have','has','had','having','do','does','did','doing',
  'can','could','may','might','must','shall','should','will','would','ought',
  'to','of','in','on','at','by','for','from','with','as','into','onto','upon','than','and','or','but','nor','so','yet','if','then','because','although','though','while','unless','whether',
  'not','no','yes','very','too','also','just','only','even','ever','never','there','here','all','any','some','each','every','either','neither','both','few','many','much','more','most','less','least','another','other','such',
  's','t','d','ll','m','re','ve'
]);
const AUX_LEMMAS=new Set(['be','have','do']);
const CONTENT_PREFIXES=['NN','VB','JJ','RB'];
const PHRASE_MAX_TOKENS=5;

function normalizeHead(value){
  return String(value||'').trim().toLowerCase().replace(/[“”]/g,'"').replace(/[’]/g,"'").replace(/\s+/g,' ');
}

function parseDictionary(){
  if(!fs.existsSync(EJDICT_DIR)) throw new Error(`EJDict source not found: ${EJDICT_DIR}`);
  const map=new Map();
  for(const name of fs.readdirSync(EJDICT_DIR).filter(x=>/^[a-z]\.txt$/i.test(x)).sort()){
    const text=fs.readFileSync(path.join(EJDICT_DIR,name),'utf8');
    for(const line of text.split(/\r?\n/)){
      const tab=line.indexOf('\t'); if(tab<1) continue;
      const head=line.slice(0,tab).trim(); const meaning=line.slice(tab+1).trim(); if(!head||!meaning) continue;
      for(const variant of head.split(/\s*,\s*/)){
        const key=normalizeHead(variant); if(!key) continue;
        if(!map.has(key)) map.set(key,meaning);
      }
    }
  }
  return map;
}

function cleanMeaning(text){
  return String(text||'')
    .replace(/〈[^〉]*〉/g,'')
    .replace(/《[^》]*》/g,'')
    .replace(/\{[^}]*\}/g,'')
    .replace(/\[[^\]]*\]/g,'')
    .replace(/\s+/g,' ')
    .replace(/^=+/,'')
    .trim();
}

function splitSenses(raw){
  const cleaned=cleanMeaning(raw);
  const parts=cleaned.split(/\s*;\s*|\s+\/\s+/).map(x=>x.trim()).filter(Boolean);
  return parts.length?parts:[cleaned].filter(Boolean);
}

function jaChars(text){
  return Array.from(String(text||'').replace(/[^一-龯ぁ-んァ-ヶー]/g,''));
}
function ngrams(chars,n){
  const out=new Set();
  for(let i=0;i<=chars.length-n;i+=1) out.add(chars.slice(i,i+n).join(''));
  return out;
}
function overlapScore(sense,ja){
  const a=jaChars(sense), b=jaChars(ja); if(!a.length||!b.length) return 0;
  let score=0;
  for(const n of [3,2]){
    const aa=ngrams(a,n), bb=ngrams(b,n);
    for(const x of aa) if(bb.has(x)) score+=n===3?5:2;
  }
  return score;
}
function pickContextMeaning(raw,ja){
  const senses=splitSenses(raw);
  let best=senses[0]||''; let bestScore=-1;
  for(const sense of senses){
    const score=overlapScore(sense,ja);
    if(score>bestScore){ best=sense; bestScore=score; }
  }
  const concise=best.length>100?best.slice(0,97)+'…':best;
  return {meaning:concise,score:Math.max(0,bestScore),confidence:bestScore>=5?'aligned_high':bestScore>=2?'aligned_medium':'dictionary_only'};
}

function posFamily(pos){
  if(/^NN/.test(pos)) return 'noun';
  if(/^VB/.test(pos)) return 'verb';
  if(/^JJ/.test(pos)) return 'adjective';
  if(/^RB/.test(pos)) return 'adverb';
  return 'other';
}
function isContentToken(token){
  if(token?.tag!=='word') return false;
  const pos=String(token.pos||'');
  if(!CONTENT_PREFIXES.some(prefix=>pos.startsWith(prefix))) return false;
  if(/^NNP/.test(pos)) return false;
  const lemma=normalizeHead(token.lemma||token.normal||token.value);
  if(!lemma||lemma.length<2||STOPWORDS.has(lemma)||AUX_LEMMAS.has(lemma)) return false;
  if(!/[a-z]/.test(lemma)) return false;
  return true;
}

function entryId(kind,headword){
  return `${kind}:${normalizeHead(headword).replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')}`;
}
function addOccurrence(store,{kind,headword,pos,surface,item,dictMeaning,context}){
  const key=entryId(kind,headword); if(!key||key.endsWith(':')) return;
  let row=store.get(key);
  if(!row){
    row={id:key,kind,headword:normalizeHead(headword),pos:new Set(),forms:new Map(),examples:[],frequency:0,dictMeaning,meaningVotes:[]};
    store.set(key,row);
  }
  if(pos&&pos!=='other') row.pos.add(pos);
  const form=String(surface||headword).trim(); if(form) row.forms.set(form,(row.forms.get(form)||0)+1);
  row.frequency+=1;
  if(!row.examples.some(x=>x.item_id===item.id) && row.examples.length<5){
    row.examples.push({item_id:item.id,en:item.en,ja:item.ja,unit:item.unit});
  }
  row.meaningVotes.push({item_id:item.id,...context});
}

function bestMeaningVote(votes){
  const safe=Array.isArray(votes)?votes:[];
  return safe.slice().sort((a,b)=>b.score-a.score || (a.confidence==='aligned_high'?-1:1))[0] || {meaning:'',score:0,confidence:'dictionary_only'};
}

function phraseCandidates(tagged,dict){
  const words=tagged.filter(t=>t.tag==='word');
  const out=[];
  for(let start=0;start<words.length;start+=1){
    for(let len=2;len<=PHRASE_MAX_TOKENS && start+len<=words.length;len+=1){
      const chunk=words.slice(start,start+len);
      const surface=normalizeHead(chunk.map(t=>t.normal||t.value).join(' '));
      const lemma=normalizeHead(chunk.map(t=>t.lemma||t.normal||t.value).join(' '));
      const candidates=[lemma,surface].filter((x,i,a)=>x&&a.indexOf(x)===i);
      const key=candidates.find(x=>dict.has(x)); if(!key) continue;
      const meaningful=chunk.some(isContentToken); if(!meaningful) continue;
      if(key.split(' ').every(x=>STOPWORDS.has(x))) continue;
      out.push({headword:key,surface:chunk.map(t=>t.value).join(' ')});
    }
  }
  // Prefer longest phrases at each start/head and de-dupe.
  const uniq=new Map();
  for(const x of out){ if(!uniq.has(x.headword) || x.surface.length>uniq.get(x.headword).surface.length) uniq.set(x.headword,x); }
  return [...uniq.values()];
}

const items=JSON.parse(fs.readFileSync(ITEMS_PATH,'utf8'));
const dict=parseDictionary();
const store=new Map();
let tokenCount=0, contentTokenCount=0, dictionaryMisses=0, phraseHits=0;
const misses=new Map();

for(const item of items){
  const tagged=tagger.tagSentence(String(item.en||''));
  tokenCount+=tagged.length;
  for(const token of tagged){
    if(!isContentToken(token)) continue;
    contentTokenCount+=1;
    const lemma=normalizeHead(token.lemma||token.normal||token.value);
    const surface=String(token.value||lemma);
    const raw=dict.get(lemma) || dict.get(normalizeHead(token.normal)) || dict.get(normalizeHead(surface));
    if(!raw){ dictionaryMisses+=1; misses.set(lemma,(misses.get(lemma)||0)+1); continue; }
    const context=pickContextMeaning(raw,item.ja);
    addOccurrence(store,{kind:'word',headword:lemma,pos:posFamily(token.pos),surface,item,dictMeaning:raw,context});
  }
  for(const phrase of phraseCandidates(tagged,dict)){
    const raw=dict.get(phrase.headword); if(!raw) continue;
    phraseHits+=1;
    const context=pickContextMeaning(raw,item.ja);
    addOccurrence(store,{kind:'phrase',headword:phrase.headword,pos:'phrase',surface:phrase.surface,item,dictMeaning:raw,context});
  }
}

const entries=[...store.values()].map(row=>{
  const best=bestMeaningVote(row.meaningVotes);
  const forms=[...row.forms.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([form,count])=>({form,count}));
  return {
    id:row.id,
    kind:row.kind,
    headword:row.headword,
    pos:[...row.pos].sort(),
    meaning_ja:best.meaning,
    meaning_confidence:best.confidence,
    meaning_alignment_score:best.score,
    forms,
    frequency:row.frequency,
    example_ids:row.examples.map(x=>x.item_id),
    examples:row.examples,
    source:{dictionary:'EJDict-hand',license:'CC0-1.0',dictionary_meaning_ja:row.dictMeaning}
  };
}).sort((a,b)=>{
  const aid=a.example_ids[0]||'Z9999', bid=b.example_ids[0]||'Z9999';
  return aid.localeCompare(bid)|| (a.kind==='phrase'?-1:1) || a.headword.localeCompare(b.headword);
});

const stats={
  schema_version:1,
  generated_at:new Date().toISOString(),
  total_example_sentences:items.length,
  tagged_tokens:tokenCount,
  content_tokens:contentTokenCount,
  dictionary_misses:dictionaryMisses,
  entries:entries.length,
  words:entries.filter(x=>x.kind==='word').length,
  phrases:entries.filter(x=>x.kind==='phrase').length,
  aligned_high:entries.filter(x=>x.meaning_confidence==='aligned_high').length,
  aligned_medium:entries.filter(x=>x.meaning_confidence==='aligned_medium').length,
  dictionary_only:entries.filter(x=>x.meaning_confidence==='dictionary_only').length,
  phrase_occurrences:phraseHits,
  top_dictionary_misses:[...misses.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,80).map(([headword,count])=>({headword,count}))
};

const database={
  schema_version:1,
  generated_at:stats.generated_at,
  purpose:'Vocabulary and phrase learning derived from the existing 560 example sentences.',
  source:{
    examples:'data/items.json',
    dictionary:{name:'EJDict-hand',url:'https://github.com/kujirahand/EJDict',license:'CC0-1.0'},
    nlp:{name:'wink-pos-tagger',version:'2.2.2',license:'MIT'}
  },
  notes:[
    'headword is the lemma/base form used as the expected English answer.',
    'meaning_ja is selected from EJDict senses using overlap with the Japanese translation of the source example; dictionary_only entries require review before production use.',
    'Proper nouns and grammatical function words are excluded from word cards.',
    'Multiword entries are included when a 2-5 token surface/lemma n-gram exactly matches an EJDict headword.'
  ],
  stats,
  entries
};

fs.writeFileSync(OUT_PATH,JSON.stringify(database,null,2)+'\n');
fs.writeFileSync(REPORT_PATH,JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
