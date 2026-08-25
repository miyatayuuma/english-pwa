import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const posTagger=require('wink-pos-tagger');
const { load }=require('cheerio');
const tagger=posTagger();

const ROOT=process.cwd();
const ITEMS_PATH=path.join(ROOT,'data/items.json');
const OUT_PATH=path.join(ROOT,'data/vocabulary-v2.json');
const REPORT_PATH=path.join(ROOT,'data/vocabulary-v2-report.json');
const EJDICT_DIR=process.env.EJDICT_DIR || path.join(ROOT,'.tmp','EJDict','src');
const INDEX_FILES=[
  path.join(ROOT,'.tmp','duo-index-1.html'),
  path.join(ROOT,'.tmp','duo-index-2.html'),
];

const FUNCTION_WORDS=new Set(['a','an','the','be','am','is','are','was','were','been','being','do','does','did','doing','to','of','in','on','at','by','for','from','with','as','than','and','or','that','this','these','those','one','ones','oneself','someone','somebody','something','anyone','anything']);
const PLACEHOLDERS=new Set(['a','b','c','x','y','z']);

function norm(s){
  return String(s||'')
    .replace(/[“”]/g,'"').replace(/[’]/g,"'")
    .replace(/〜/g,'～').replace(/…+/g,'…')
    .replace(/\s+/g,' ').trim();
}
function lower(s){ return norm(s).toLowerCase(); }
function sectionNumber(unit){ const m=String(unit||'').match(/Section\s*(\d+)/i); return m?Number(m[1]):null; }

function parseDictionary(){
  const map=new Map();
  if(!fs.existsSync(EJDICT_DIR)) throw new Error(`EJDict source not found: ${EJDICT_DIR}`);
  for(const name of fs.readdirSync(EJDICT_DIR).filter(x=>/^[a-z]\.txt$/i.test(x)).sort()){
    const text=fs.readFileSync(path.join(EJDICT_DIR,name),'utf8');
    for(const line of text.split(/\r?\n/)){
      const tab=line.indexOf('\t'); if(tab<1) continue;
      const head=line.slice(0,tab).trim(); const meaning=line.slice(tab+1).trim();
      if(!head||!meaning) continue;
      for(const variant of head.split(/\s*,\s*/)){
        const key=lower(variant); if(key&&!map.has(key)) map.set(key,meaning);
      }
    }
  }
  return map;
}

function cleanMeaning(text){
  return String(text||'')
    .replace(/〈[^〉]*〉/g,'').replace(/《[^》]*》/g,'')
    .replace(/\{[^}]*\}/g,'').replace(/\[[^\]]*\]/g,'')
    .replace(/\s+/g,' ').trim();
}
function splitSenses(raw){
  const cleaned=cleanMeaning(raw);
  return cleaned.split(/\s*;\s*|\s+\/\s+/).map(x=>x.trim()).filter(Boolean);
}
function jaChars(text){ return Array.from(String(text||'').replace(/[^一-龯ぁ-んァ-ヶー]/g,'')); }
function grams(chars,n){ const s=new Set(); for(let i=0;i<=chars.length-n;i++) s.add(chars.slice(i,i+n).join('')); return s; }
function overlapScore(a,b){
  const aa=jaChars(a), bb=jaChars(b); if(!aa.length||!bb.length) return 0;
  let score=0;
  for(const n of [3,2]){ const x=grams(aa,n),y=grams(bb,n); for(const g of x) if(y.has(g)) score+=n===3?5:2; }
  return score;
}
function chooseMeaning(raw,ja){
  if(!raw) return {meaning_ja:null,meaning_confidence:'missing',score:0};
  const senses=splitSenses(raw); let best=senses[0]||'', bestScore=-1;
  for(const sense of senses){ const s=overlapScore(sense,ja); if(s>bestScore){ best=sense; bestScore=s; } }
  return {meaning_ja:best.slice(0,120),meaning_confidence:bestScore>=5?'aligned_high':bestScore>=2?'aligned_medium':'dictionary_only',score:Math.max(0,bestScore)};
}

function extractIndexRows(html){
  const $=load(html);
  const text=$('body').text().replace(/\u00a0/g,' ');
  const lines=text.split(/\r?\n/).map(norm).filter(Boolean);
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const meaningLine=lines[i];
    const sm=meaningLine.match(/SECTION\s*(\d{1,2})|\b(\d{1,2})\s*SECTION\b/i);
    if(!sm) continue;
    const section=Number(sm[1]||sm[2]);
    if(!(section>=1&&section<=45)) continue;
    const head=norm(lines[i-1]);
    if(!/[A-Za-z]/.test(head)||head.length>150||/DUO 3\.0|SECTION/i.test(head)) continue;
    rows.push({headword_raw:head,section});
  }
  const seen=new Set();
  return rows.filter(row=>{
    const key=`${row.section}|${lower(row.headword_raw)}`;
    if(seen.has(key)) return false; seen.add(key); return true;
  });
}

function firstVariant(raw){
  let s=lower(raw)
    .replace(/[［【]/g,'[').replace(/[］】]/g,']')
    .replace(/～/g,' … ')
    .replace(/\[[^\]]+\]/g,'')
    .replace(/\([^)]*\)/g,'')
    .replace(/\{[^}]*\}/g,'')
    .split('/')[0]
    .replace(/[,.!?;:]/g,' ')
    .replace(/[=<>]/g,' ')
    .replace(/\s+/g,' ').trim();
  return s;
}
function canonicalDisplay(raw){
  return norm(raw)
    .replace(/\s*SECTION.*$/i,'')
    .replace(/～/g,'…')
    .replace(/\s+/g,' ').trim();
}
function isPhraseHead(raw){
  const s=lower(raw);
  return /\s/.test(s)||/[()\[\]～…/]/.test(s)||/\b(one's|oneself|somebody|someone|doing|to do)\b/.test(s);
}

function tagWords(text){
  return tagger.tagSentence(String(text||''))
    .filter(t=>t.tag==='word')
    .map(t=>({surface:lower(t.value),lemma:lower(t.lemma||t.normal||t.value),pos:String(t.pos||'')}));
}
function anchorsFor(raw){
  const variant=firstVariant(raw);
  if(!variant) return [];
  const tagged=tagWords(variant);
  const out=[];
  for(const token of tagged){
    const v=token.lemma||token.surface;
    if(!v||PLACEHOLDERS.has(v)||v==='…'||/^one'?s$/.test(v)) continue;
    if(['somebody','someone','something','anything','anyone','oneself'].includes(v)) continue;
    if(v==='be'||v==='do') continue;
    out.push(v);
  }
  return out;
}
function sentenceLemmas(en){ return tagWords(en).map(t=>t.lemma||t.surface); }
function orderedSubsequence(anchors,tokens,maxGap=7){
  if(!anchors.length) return false;
  let pos=-1;
  for(const anchor of anchors){
    let found=-1;
    for(let i=pos+1;i<tokens.length&&i<=pos+1+maxGap;i++){
      if(tokens[i]===anchor){ found=i; break; }
    }
    if(found<0) return false; pos=found;
  }
  return true;
}
function matchScore(raw,itemTokens){
  const anchors=anchorsFor(raw); if(!anchors.length) return -1;
  if(!orderedSubsequence(anchors,itemTokens,8)) return -1;
  let score=anchors.length*10;
  if(anchors.length>=2) score+=8;
  const particles=anchors.filter(x=>FUNCTION_WORDS.has(x)); score+=particles.length*2;
  return score;
}

function dictionaryKeys(raw){
  const keys=[];
  const add=s=>{ const k=lower(s).replace(/[…～]/g,'').replace(/\s+/g,' ').trim(); if(k&&!keys.includes(k)) keys.push(k); };
  add(raw);
  add(firstVariant(raw));
  const anchors=anchorsFor(raw); if(anchors.length) add(anchors.join(' '));
  if(anchors.length===1) add(anchors[0]);
  return keys;
}
function lookupMeaning(dict,raw,example){
  for(const key of dictionaryKeys(raw)){
    const rawMeaning=dict.get(key); if(rawMeaning) return {dictionary_key:key,...chooseMeaning(rawMeaning,example?.ja||'')};
  }
  return {dictionary_key:null,meaning_ja:null,meaning_confidence:'missing',score:0};
}

const items=JSON.parse(fs.readFileSync(ITEMS_PATH,'utf8'));
const bySection=new Map();
for(const item of items){
  const section=sectionNumber(item.unit); if(!section) continue;
  const tagged={item,tokens:sentenceLemmas(item.en)};
  if(!bySection.has(section)) bySection.set(section,[]); bySection.get(section).push(tagged);
}
const dict=parseDictionary();
const indexRows=INDEX_FILES.flatMap(file=>extractIndexRows(fs.readFileSync(file,'utf8')));

const entries=[]; const unmatched=[];
for(const row of indexRows){
  const candidates=bySection.get(row.section)||[];
  const scored=candidates.map(c=>({...c,score:matchScore(row.headword_raw,c.tokens)})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score);
  const bestScore=scored[0]?.score ?? -1;
  const matched=scored.filter(x=>x.score===bestScore).slice(0,3);
  if(!matched.length){ unmatched.push(row); continue; }
  const example=matched[0].item;
  const meaning=lookupMeaning(dict,row.headword_raw,example);
  const headword=canonicalDisplay(row.headword_raw);
  entries.push({
    id:`duo:${row.section}:${entries.length+1}`,
    kind:isPhraseHead(row.headword_raw)?'phrase':'word',
    headword,
    section:row.section,
    example_ids:matched.map(x=>x.item.id),
    examples:matched.map(x=>({item_id:x.item.id,en:x.item.en,ja:x.item.ja,unit:x.item.unit})),
    meaning_ja:meaning.meaning_ja,
    meaning_confidence:meaning.meaning_confidence,
    dictionary_key:meaning.dictionary_key,
    match_confidence:bestScore>=28?'high':bestScore>=18?'medium':'low',
    source:{index:'english4ed public DUO index',meaning:'EJDict-hand CC0 + existing example translation'}
  });
}

const dedup=new Map();
for(const entry of entries){
  const key=`${entry.section}|${lower(entry.headword)}`;
  if(!dedup.has(key)) dedup.set(key,entry);
}
const finalEntries=[...dedup.values()];
const ready=finalEntries.filter(e=>e.meaning_ja&&e.match_confidence!=='low');
const report={
  schema_version:2,
  generated_at:new Date().toISOString(),
  source_index_rows:indexRows.length,
  matched_entries:finalEntries.length,
  unmatched_entries:unmatched.length,
  words:finalEntries.filter(e=>e.kind==='word').length,
  phrases:finalEntries.filter(e=>e.kind==='phrase').length,
  ready_for_cards:ready.length,
  meanings_high:finalEntries.filter(e=>e.meaning_confidence==='aligned_high').length,
  meanings_medium:finalEntries.filter(e=>e.meaning_confidence==='aligned_medium').length,
  meanings_dictionary_only:finalEntries.filter(e=>e.meaning_confidence==='dictionary_only').length,
  meanings_missing:finalEntries.filter(e=>e.meaning_confidence==='missing').length,
  match_high:finalEntries.filter(e=>e.match_confidence==='high').length,
  match_medium:finalEntries.filter(e=>e.match_confidence==='medium').length,
  match_low:finalEntries.filter(e=>e.match_confidence==='low').length,
  unmatched_sample:unmatched.slice(0,80)
};
const db={
  schema_version:2,
  generated_at:report.generated_at,
  purpose:'DUO-like vocabulary/phrase database aligned to the existing 560 example sentences.',
  policy:{
    index_usage:'Third-party public indexes are used only to verify likely English headwords/phrases and section placement. Japanese glosses from those pages are not copied.',
    meanings:'Japanese meanings come from CC0 EJDict-hand selected against the existing Japanese example translation.',
  },
  stats:report,
  entries:finalEntries
};
fs.writeFileSync(OUT_PATH,JSON.stringify(db,null,2)+'\n');
fs.writeFileSync(REPORT_PATH,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
