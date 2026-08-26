export const TAGGING_SCHEMA_VERSION=3;

export const TAG_AXES=Object.freeze({
  speaker:{field:'speaker_tags',labelJa:'話者'},
  mentioned_character:{field:'mentioned_character_tags',labelJa:'言及人物'},
  situation:{field:'situation_tags',labelJa:'場面・話題'},
  grammar:{field:'grammar_tags',labelJa:'文法'},
  construction:{field:'construction_tags',labelJa:'構文'},
  sentence_pattern:{field:'sentence_patterns',labelJa:'5文型'},
  function:{field:'function_tags',labelJa:'会話機能'},
  vocabulary:{field:null,labelJa:'語彙・表現',external:true},
});

export const GRAMMAR_HIERARCHY=Object.freeze([
  Object.freeze({
    id:'modal_future',labelJa:'助動詞・未来',
    children:Object.freeze(['modal_must','modal_should','modal_can','modal_could','modal_may_might','modal_would','future_will','have_to','be_going_to']),
  }),
  Object.freeze({
    id:'tense_aspect',labelJa:'時制・相',
    children:Object.freeze(['present_perfect','past_perfect','present_progressive','past_progressive']),
  }),
  Object.freeze({
    id:'voice',labelJa:'態',
    children:Object.freeze(['passive_voice']),
  }),
  Object.freeze({
    id:'clause_relation',labelJa:'節・文のつながり',
    children:Object.freeze(['if_or_unless_clause','relative_clause','reported_speech','subordinate_clause','participial_or_reduced_clause']),
  }),
  Object.freeze({
    id:'mood',labelJa:'法・条件表現',
    children:Object.freeze(['subjunctive']),
  }),
  Object.freeze({
    id:'sentence_type',labelJa:'文の種類',
    children:Object.freeze(['imperative','question']),
  }),
]);

export const CONSTRUCTION_HIERARCHY=Object.freeze([
  Object.freeze({id:'existential',labelJa:'存在構文',children:Object.freeze(['there_be'])}),
  Object.freeze({id:'it_structure',labelJa:'It構文',children:Object.freeze(['it_that_structure'])}),
  Object.freeze({id:'comparison',labelJa:'比較構文',children:Object.freeze(['correlative_comparative','not_so_much_as'])}),
  Object.freeze({id:'inversion',labelJa:'倒置構文',children:Object.freeze(['inversion_no_sooner'])}),
  Object.freeze({id:'causative',labelJa:'使役構文',children:Object.freeze(['causative_have'])}),
]);

export const SENTENCE_PATTERNS=Object.freeze(['SV','SVC','SVO','SVOO','SVOC']);
export const SPEAKER_SOURCES=Object.freeze(['explicit','contextual','app_cast']);
export const SPEAKER_CONFIDENCE=Object.freeze(['high','medium']);

const CONSTRUCTION_IDS=new Set(CONSTRUCTION_HIERARCHY.flatMap(group=>group.children));
const SENTENCE_PATTERN_SET=new Set(SENTENCE_PATTERNS);
const SPEAKER_SOURCE_SET=new Set(SPEAKER_SOURCES);
const SPEAKER_CONFIDENCE_SET=new Set(SPEAKER_CONFIDENCE);

export function splitGrammarAndConstructionTags(tags){
  const grammar=[];
  const construction=[];
  for(const raw of Array.isArray(tags)?tags:[]){
    const id=String(raw||'').trim();
    if(!id) continue;
    (CONSTRUCTION_IDS.has(id)?construction:grammar).push(id);
  }
  return {
    grammar:[...new Set(grammar)],
    construction:[...new Set(construction)],
  };
}

export function normalizeSpeakerTags(raw){
  const byId=new Map();
  for(const entry of Array.isArray(raw)?raw:[]){
    const id=String(entry?.id||'').trim();
    const source=String(entry?.source||'').trim();
    const confidence=String(entry?.confidence||'').trim();
    if(!id||!SPEAKER_SOURCE_SET.has(source)||!SPEAKER_CONFIDENCE_SET.has(confidence)) continue;
    const normalized={id,source,confidence};
    const existing=byId.get(id);
    if(!existing){ byId.set(id,normalized); continue; }
    const sourceRank={explicit:3,contextual:2,app_cast:1};
    const confidenceRank={high:2,medium:1};
    const nextRank=sourceRank[source]*10+confidenceRank[confidence];
    const oldRank=sourceRank[existing.source]*10+confidenceRank[existing.confidence];
    if(nextRank>oldRank) byId.set(id,normalized);
  }
  return [...byId.values()];
}

export function normalizeSentencePatterns(raw){
  const main=SENTENCE_PATTERN_SET.has(raw?.main)?raw.main:null;
  const clauses=[...new Set((Array.isArray(raw?.clauses)?raw.clauses:[]).filter(value=>SENTENCE_PATTERN_SET.has(value)))];
  return {main,clauses};
}

export function validateTaggingV3Item(item){
  const errors=[];
  if(!item?.id) errors.push('missing id');
  for(const field of ['character_tags','mentioned_character_tags','speaker_tags','situation_tags','grammar_tags','construction_tags','function_tags']){
    if(!Array.isArray(item?.[field])) errors.push(`${field} must be an array`);
  }
  if(item?.grammar_tags?.some(id=>CONSTRUCTION_IDS.has(id))) errors.push('construction tag remains in grammar_tags');
  for(const speaker of item?.speaker_tags||[]){
    if(!speaker?.id) errors.push('speaker tag missing id');
    if(!SPEAKER_SOURCE_SET.has(speaker?.source)) errors.push(`invalid speaker source: ${speaker?.source}`);
    if(!SPEAKER_CONFIDENCE_SET.has(speaker?.confidence)) errors.push(`invalid speaker confidence: ${speaker?.confidence}`);
  }
  const patterns=normalizeSentencePatterns(item?.sentence_patterns);
  if(item?.sentence_patterns?.main!==patterns.main) errors.push('invalid main sentence pattern');
  const rawClauses=Array.isArray(item?.sentence_patterns?.clauses)?item.sentence_patterns.clauses:[];
  if(rawClauses.length!==patterns.clauses.length) errors.push('invalid clause sentence pattern');
  return errors;
}

export function grammarParentFor(tagId){
  return GRAMMAR_HIERARCHY.find(group=>group.children.includes(tagId))?.id||null;
}

export function constructionParentFor(tagId){
  return CONSTRUCTION_HIERARCHY.find(group=>group.children.includes(tagId))?.id||null;
}
