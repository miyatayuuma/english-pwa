import fs from 'node:fs';
import {
  TAGGING_SCHEMA_VERSION,
  normalizeSentencePatterns,
  normalizeSpeakerTags,
  splitGrammarAndConstructionTags,
  validateTaggingV3Item,
} from './tagTaxonomy.mjs';

const ITEMS_PATH=new URL('../../data/items.json',import.meta.url);
const REPORT_PATH=new URL('../../data/tagging-report.json',import.meta.url);
const TAGGING_VERSION=TAGGING_SCHEMA_VERSION;

const PERSON_NAMES={
  bob:['Bob'],
  jennifer:['Jennifer'],
  nick:['Nick'],
  lisa:['Lisa'],
  jane:['Jane'],
  joe:['Joe'],
  dave:['Dave'],
  tom:['Tom'],
  ken:['Ken'],
  naomi:['Naomi'],
  lucy:['Lucy'],
  richie:['Richie'],
  starr:['Starr'],
  dolly:['Dolly'],
  phil:['Phil'],
  mike:['Mike'],
  michael:['Michael'],
  brian:['Brian'],
  teresa:['Teresa'],
  ted:['Ted'],
  jason:['Jason'],
  john:['John'],
  bill:['Bill'],
  monica:['Monica'],
  molly:['Molly'],
  richard:['Richard'],
  ms_yamada:['Ms. Yamada'],
  ando:['Ando'],
  giotto:['Giotto'],
  johnson:['Johnson'],
};

const MANUAL_EXPLICIT={
  E0437:[{id:'senator_ford',certainty:'explicit',reason:'explicit_name'}],
  E0438:[{id:'senator_ford',certainty:'explicit',reason:'same_named_person_ford'}],
};

const SITUATION_RULES=[
  ['values_society',/\b(equality|equal rights?|fair to everyone|national origin|gender|creed|discrimination|prejudice|dignity|integrity|individual rights?|civil rights?|human rights?)\b/i],
  ['romance_relationship',/\b(love|girlfriend|boyfriend|single|propos(?:e|ed|al)|dating|marri(?:ed|age)|engag(?:ed|ement)|divorc(?:e|ed)|romantic|broke up|break it off|seeing someone|couple|anniversary|embrac(?:e|ed)|jealous|betray(?:ed|al)|make up|we're through|on a date)\b/i],
  ['family_home',/\b(wife|husband|mom|mother|father|parents?|grandma|son\b|daughter|baby|kids?|children|family|niece|nephew|cousin|chores?|laundry|dishes|fridge|microwave|faucet)\b/i],
  ['workplace_career',/\b(work\b|job|boss|office|company|firm|employee|employer|personnel|resume|interview|trainee|colleague|promotion|promoted|overtime|branch|transferred|commute|career|workshop|business)\b/i],
  ['school_education',/\b(school|college|university|assignment|thesis|essay|summary|math|scholarship|tuition|freshman|major\b|formula|chapter|academic|education|graduate|graduated)\b/i],
  ['travel_transport',/\b(flight|plane|cabin|aviation|passenger|cab\b|taxi|car\b|rusty ford|traffic|road\b|intersection|tire|ambulance|reservation|baggage|fare|destination|departure|check in|shuttle|motel|suite|abroad|jet lag|voyage|vehicle)\b/i],
  ['shopping_money',/\b(buy|purchase|sale\b|cash|expense|bank(?: account)?|tax\b|charge|dollars?|owe|debt|discount|profit|bankrupt|income|wage|salary|rent\b|stocks?|invest(?:ment|ing)?|budget|revenue|fare)\b/i],
  ['food_dining',/\b(natto|food|meal|restaurant|cook\b|appetite|beverage|nutrition|junk food|dinner|eat out|snacks?|flour|leftovers|hungry|hunger|starved)\b/i],
  ['health_medical',/\b(flu|pills?|medical|disease|illness|symptoms?|fever|sore throat|cancer|stiff neck|headache|dizzy|throwing up|aspirin|physician|surgeon|transplant|infection|pregnant|infant|blood|exercise|mortality|injur(?:y|ed)|ankle|injection|bedridden)\b/i],
  ['science_technology',/\b(cloning|gene|evolution|biologist|brain|microscope|particles?|cells?|hydrogen|oxygen|celsius|AI\b|artificial intelligence|technology|website|computer|PC\b|gadget|satellite|astronom(?:er|y|ical)|universe|zero gravity|thermometer|barometer)\b/i],
  ['politics_government',/\b(president|parliament|government|minister|cabinet|congress|legislation|administration|candidate|mayor|council|senator|politician|bureaucrat|federal|diplomatic|summit|ambassador|treaty|sanctions?|tariffs?)\b/i],
  ['law_crime',/\b(lawyer|attorney|legal|court|police|cops?|trial|jury|guilty|arrest|detective|crime|murder|suspect|fingerprints?|weapon|kidnapping|thief|fraud|bribes?|corruption|testimony|illegal)\b/i],
  ['war_conflict',/\b(terror(?:ism|ist)?|rebel|troops?|riot|armed forces|enemy|surrender|hostages?|tyranny|invasion|civil war|colony|independence|conflict|disarmament|attack|soldiers?|territory)\b/i],
  ['environment_geography',/\b(planet|flood|equator|wildlife|extinction|drought|rain forests?|global warming|ozone|pollution|glaciers?|petroleum|fossil fuels?|mineral|soil|climate|volcano|canal|earthquake|typhoon|foggy|geographical|peninsula|crops?)\b/i],
  ['arts_culture',/\b(literature|novel|prose|poetry|encyclopedia|fairy tale|fable|art\b|works? are on display|exhibition|portrait|cathedral|renaissance|sculpture|myths?|legends?|linguist|tribe|masterpiece|classical music|autobiography|manuscript)\b/i],
  ['social_communication',/\b(conversation|talk\b|talking|chat|chatting|call\b|phone|e-mail|email|letter|apolog(?:y|ize|ized)|compliment|teas(?:e|ed|ing)|insult|small talk|discuss|remark|reply|pronunciation|vocabulary)\b/i],
  ['personality_emotion',/\b(attitude|shy|timid|coward|passive|stubborn|jealous|selfish|greedy|optimistic|pessimistic|lonely|uneasy|embarrass(?:ed|ing)?|irritat(?:ed|ing)|anger|angry|rage|afraid|fear|scared|grief|sorrow|delight|miserable|contempt|arrogance|honesty|dignity|integrity|courage|wisdom)\b/i],
  ['religion_funeral',/\b(religion|sacred|ritual|buddhist|priest|pray(?:er|ed)?|souls? of the deceased|funeral|passed away|ancestors?)\b/i],
  ['danger_disaster',/\b(accident|crash|catastrophe|disaster|fire\b|caught fire|blaze|exploded|bomb\b|bullet|wounded|sank|froze to death|earthquake|flood|typhoon|tragedy|emergency|robbed|collision)\b/i],
  ['leisure_hobby',/\b(pastime|strolling|playing cards|cartoons?|insects?|game\b|spectators?|meditation)\b/i],
];

function grammarTags(text){
  const t=` ${text.replace(/[“”]/g,'"')} `;
  const tags=new Set();
  if(/\bmust\b/i.test(t)) tags.add('modal_must');
  if(/\b(should|ought to)\b/i.test(t)) tags.add('modal_should');
  if(/\b(can|cannot|can't)\b/i.test(t)) tags.add('modal_can');
  if(/\b(could|couldn't)\b/i.test(t)) tags.add('modal_could');
  if(/\b(may|might)\b/i.test(t)) tags.add('modal_may_might');
  if(/\b(would|wouldn't|'d rather)\b/i.test(t)) tags.add('modal_would');
  if(/\bwon't\b|\bwill\s+(?!of\b|to\b|and\b|the\b|a\b|an\b|my\b|your\b|his\b|her\b|our\b|their\b)[a-z']+\b|\b(?:I|you|he|she|it|we|they)'ll\b/i.test(t)) tags.add('future_will');
  if(/\b(have|has|had) to\b/i.test(t)) tags.add('have_to');
  if(/\b(am|is|are|'m|'re) going to\b/i.test(t)) tags.add('be_going_to');
  if(/\b(if|unless)\b/i.test(t)) tags.add('if_or_unless_clause');
  if(/\b(if only|wish I|wish we|wish he|wish she|as if .* were)\b/i.test(t)) tags.add('subjunctive');
  if(/\bno sooner had\b/i.test(t)) tags.add('inversion_no_sooner');
  if(/\b(the more|the less).+\b(the more|the less)\b/i.test(t)) tags.add('correlative_comparative');
  if(/\bnot so much\b.+\bas\b/i.test(t)) tags.add('not_so_much_as');
  if(/,\s*(who|which|whose)\b/i.test(t)||/\b(those|people|person|man|woman|someone|anyone|students?|workers?|things?)\s+(who|which|whose)\b/i.test(t)) tags.add('relative_clause');
  if(/\b(there is|there are|there was|there were|there's)\b/i.test(t)) tags.add('there_be');
  if(/\b(it is|it's|it was)\s+[^.!?]{0,60}\bthat\b/i.test(t)) tags.add('it_that_structure');
  if(/\b(have|has|'ve)\s+(?:already\s+|just\s+|never\s+|ever\s+)?(?:been|gone|done|made|seen|found|got|gotten|come|become|taken|given|known|written|spoken|lost|left|grown|shown|bought|brought|caught|thought|felt|kept|held|heard|read|said|told|paid|put|set|run|risen|fallen|worn|broken|forgotten|chosen|driven|eaten|drunk|[a-z]+ed)\b/i.test(t)) tags.add('present_perfect');
  if(/\bhad\s+(?:already\s+|just\s+|never\s+)?(?:been|gone|done|made|seen|found|got|gotten|come|become|taken|given|known|written|spoken|lost|left|grown|shown|bought|brought|caught|thought|felt|kept|held|heard|read|said|told|paid|put|set|run|risen|fallen|worn|broken|forgotten|chosen|driven|eaten|drunk|[a-z]+ed)\b/i.test(t)) tags.add('past_perfect');
  if(/\b(am|is|are|'m|'re)\s+(?!going\s+to\b)[a-z]+ing\b/i.test(t)) tags.add('present_progressive');
  if(/\b(was|were)\s+[a-z]+ing\b/i.test(t)) tags.add('past_progressive');
  if(/\b(am|is|are|was|were|be|been|being)\s+(?:\w+\s+){0,2}(?:[a-z]+ed|[a-z]+en|known|given|taken|made|built|born|found|lost|left|held|caught|brought|bought|said|told|put|set|sent|sold|shown|thrown|grown|worn|written|driven|done)\b/i.test(t)) tags.add('passive_voice');
  if(/^[\s"']*(please\s+)?(take|let|keep|turn|stop|put|add|watch|cover|go|give|hold|tighten|learn|enclose|submit|be sure|don't|do not)\b/i.test(text)) tags.add('imperative');
  if(/\?/.test(text)) tags.add('question');
  if(/\b(said|saying|says|asked|exclaimed|shouted|whispered|argues|claimed|contends|predicts|warned|advised|recommended)\b/i.test(t)) tags.add('reported_speech');
  if(/^\s*(while|when|after|before|since|although|even though|as soon as|once|whenever|now that)\b/i.test(text)) tags.add('subordinate_clause');
  if(/^\s*(dressed|informed|compared|having|owing|speaking)\b/i.test(text)) tags.add('participial_or_reduced_clause');
  if(/\bhave (?:it|him|her|them|the \w+) (?:repaired|fixed|done|checked|made)\b/i.test(t)) tags.add('causative_have');
  return [...tags];
}

function functionTags(text){
  const tags=new Set();
  if(/\?/.test(text)) tags.add('asking');
  if(/\b(please|could you|can you|would you|do me a favor|i'd like you to)\b/i.test(text)) tags.add('requesting');
  if(/\b(should|ought to|why don't you|you'd better|if i were you)\b/i.test(text)) tags.add('advising');
  if(/\b(i think|in my opinion|i don't think|i believe|we believe|i suggest|what do you think)\b/i.test(text)) tags.add('opinion');
  if(/\b(i'm sorry|sorry|apologize|forgive me)\b/i.test(text)) tags.add('apology');
  if(/\b(thank|thanks|grateful|appreciate)\b/i.test(text)) tags.add('gratitude');
  if(/\b(congratulations|good for you|cheer up|you can make it|stand by you)\b/i.test(text)) tags.add('encouragement');
  if(/\b(don't|stop\b|can't stand|fed up|sick of|hate\b|complain|gets on my nerves)\b/i.test(text)) tags.add('complaint_or_protest');
  if(/\b(because|therefore|as a result|that's why|owing to|on account of)\b/i.test(text)||/\bso\b[^.!?]{0,80}\bthat\b/i.test(text)) tags.add('reason_or_result');
  return [...tags];
}

function explicitCharacters(item){
  const text=`${item.en||''} ${item.ja||''}`;
  const found=[];
  for(const [id,names] of Object.entries(PERSON_NAMES)){
    if(names.some(name=>new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(text))){
      found.push({id,certainty:'explicit',reason:'explicit_name'});
    }
  }
  for(const entry of MANUAL_EXPLICIT[item.id]||[]){
    if(!found.some(x=>x.id===entry.id)) found.push(entry);
  }
  return found;
}

function situationTags(text){
  const out=[];
  for(const [tag,pattern] of SITUATION_RULES){
    if(pattern.test(text)) out.push(tag);
  }
  return out.length?out:['general'];
}

function baseTags(raw){
  return String(raw||'')
    .split(',')
    .map(x=>x.trim())
    .filter(Boolean)
    .filter(x=>!/^(character|mentioned_character|speaker|situation|grammar|construction|pattern|function):/.test(x));
}

function enrich(item){
  const combined=`${item.en||''} ${item.ja||''}`;
  const mentionedCharacters=explicitCharacters(item);
  const situations=situationTags(combined);
  const detectedGrammar=grammarTags(item.en||'');
  const {grammar,construction}=splitGrammarAndConstructionTags(detectedGrammar);
  const functions=functionTags(item.en||'');
  const speakers=normalizeSpeakerTags(item.speaker_tags);
  const sentencePatterns=normalizeSentencePatterns(item.sentence_patterns);
  const flat=new Set(baseTags(item.tags));

  for(const speaker of speakers) flat.add(`speaker:${speaker.id}`);
  for(const s of situations) flat.add(`situation:${s}`);
  for(const g of grammar) flat.add(`grammar:${g}`);
  for(const c of construction) flat.add(`construction:${c}`);
  for(const p of [sentencePatterns.main,...sentencePatterns.clauses].filter(Boolean)) flat.add(`pattern:${p}`);
  for(const f of functions) flat.add(`function:${f}`);

  const {character_tags:_legacyCharacterTags,...rest}=item;
  return {
    ...rest,
    tags:[...flat].join(','),
    mentioned_character_tags:mentionedCharacters,
    speaker_tags:speakers,
    situation_tags:situations,
    grammar_tags:grammar,
    construction_tags:construction,
    sentence_patterns:sentencePatterns,
    function_tags:functions,
    tagging_version:TAGGING_VERSION,
  };
}

function countTags(items,field){
  const counts={};
  for(const item of items){
    for(const tag of item[field]||[]){
      const key=typeof tag==='string'?tag:`${tag.id}:${tag.certainty||tag.source||'unknown'}`;
      counts[key]=(counts[key]||0)+1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
}

function countSentencePatterns(items){
  const counts={};
  for(const item of items){
    const patterns=new Set([item?.sentence_patterns?.main,...(item?.sentence_patterns?.clauses||[])].filter(Boolean));
    for(const pattern of patterns) counts[pattern]=(counts[pattern]||0)+1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
}

const items=JSON.parse(fs.readFileSync(ITEMS_PATH,'utf8'));
if(!Array.isArray(items)||items.length!==560){
  throw new Error(`Expected 560 items, got ${Array.isArray(items)?items.length:'non-array'}`);
}
const enriched=items.map(enrich);
for(const item of enriched){
  const errors=validateTaggingV3Item(item);
  if(errors.length) throw new Error(`Tagging invariant failed for ${item?.id||'unknown item'}: ${errors.join('; ')}`);
}

const report={
  tagging_version:TAGGING_VERSION,
  total_items:enriched.length,
  mentioned_character_items:enriched.filter(x=>x.mentioned_character_tags.length).length,
  speaker_tagged_items:enriched.filter(x=>x.speaker_tags.length).length,
  generic_situation_items:enriched.filter(x=>x.situation_tags.length===1&&x.situation_tags[0]==='general').length,
  mentioned_character_counts:countTags(enriched,'mentioned_character_tags'),
  speaker_counts:countTags(enriched,'speaker_tags'),
  situation_counts:countTags(enriched,'situation_tags'),
  grammar_counts:countTags(enriched,'grammar_tags'),
  construction_counts:countTags(enriched,'construction_tags'),
  sentence_pattern_counts:countSentencePatterns(enriched),
  function_counts:countTags(enriched,'function_tags'),
};

fs.writeFileSync(ITEMS_PATH,`${JSON.stringify(enriched,null,2)}\n`);
fs.writeFileSync(REPORT_PATH,`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify(report,null,2));
