export const BROWSE_TYPES=Object.freeze(['character','skill']);

export const BROWSE_TYPE_META=Object.freeze({
  character:{label:'連絡先'},
  skill:{label:'英語スキル'},
});

export const SKILL_GROUP_META=Object.freeze({
  sentence_pattern:{label:'5文型',order:0},
  grammar:{label:'文法',order:1},
  construction:{label:'構文',order:2},
});

const SITUATION_LABELS=Object.freeze({
  values_society:'価値観・社会',romance_relationship:'恋愛・関係',family_home:'家族・家庭',
  workplace_career:'仕事・キャリア',school_education:'学校・教育',travel_transport:'旅行・移動',
  shopping_money:'買い物・お金',food_dining:'食事',health_medical:'健康・医療',
  science_technology:'科学・技術',politics_government:'政治・行政',law_crime:'法律・犯罪',
  war_conflict:'戦争・対立',environment_geography:'環境・地理',arts_culture:'芸術・文化',
  social_communication:'会話・交流',personality_emotion:'性格・感情',religion_funeral:'宗教・葬儀',
  danger_disaster:'危険・災害',leisure_hobby:'趣味・余暇',general:'一般',
});

const GRAMMAR_LABELS=Object.freeze({
  modal_must:'must',modal_should:'should',modal_can:'can',modal_could:'could',modal_may_might:'may / might',
  modal_would:'would',future_will:'will',have_to:'have to',be_going_to:'be going to',
  if_or_unless_clause:'if / unless',subjunctive:'仮定法',relative_clause:'関係詞',
  present_perfect:'現在完了',past_perfect:'過去完了',present_progressive:'現在進行形',past_progressive:'過去進行形',
  passive_voice:'受動態',imperative:'命令文',question:'疑問文',reported_speech:'話法',
  subordinate_clause:'従属節',participial_or_reduced_clause:'分詞・省略節',
});

const CONSTRUCTION_LABELS=Object.freeze({
  there_be:'there is / are',it_that_structure:'It ... that',correlative_comparative:'比較構文',
  not_so_much_as:'not so much A as B',inversion_no_sooner:'no sooner / 倒置',causative_have:'使役 have',
});

const FUNCTION_LABELS=Object.freeze({
  asking:'質問',requesting:'依頼',advising:'助言',opinion:'意見',apology:'謝罪',gratitude:'感謝',
  encouragement:'励まし',complaint_or_protest:'不満・抗議',reason_or_result:'理由・結果',
});

const SENTENCE_PATTERNS=Object.freeze(['SV','SVC','SVO','SVOO','SVOC']);

function humanize(value){
  return String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
}

export function labelForTag(type,id){
  if(type==='situation') return SITUATION_LABELS[id]||humanize(id);
  if(type==='grammar') return GRAMMAR_LABELS[id]||humanize(id);
  if(type==='construction') return CONSTRUCTION_LABELS[id]||humanize(id);
  if(type==='function') return FUNCTION_LABELS[id]||humanize(id);
  if(type==='sentence_pattern') return String(id||'');
  return humanize(id);
}

export function itemLevel(levelState,itemId){
  const raw=levelState&&levelState[itemId];
  if(!raw||typeof raw!=='object') return 0;
  const last=Number(raw.last);
  const best=Number(raw.best);
  if(Number.isFinite(last)) return Math.max(0,Math.min(5,last));
  if(Number.isFinite(best)) return Math.max(0,Math.min(5,best));
  return 0;
}

export function itemIsDue(levelState,itemId,now=Date.now()){
  const raw=levelState&&levelState[itemId];
  if(!raw||typeof raw!=='object') return false;
  const level=itemLevel(levelState,itemId);
  if(level<=0) return false;
  const nextDueAt=Number(raw.review?.nextDueAt??raw.nextDueAt??0);
  return Number.isFinite(nextDueAt)&&nextDueAt>0&&nextDueAt<=now;
}

export function hasSpeaker(item,characterId){
  return (Array.isArray(item?.speaker_tags)?item.speaker_tags:[]).some(tag=>tag?.id===characterId);
}

function parseSkillId(id){
  const raw=String(id||'');
  const split=raw.indexOf(':');
  if(split<=0) return null;
  const axis=raw.slice(0,split);
  const value=raw.slice(split+1);
  if(!value||!['grammar','construction','sentence_pattern'].includes(axis)) return null;
  return {axis,value};
}

export function matchesTag(item,type,id){
  if(!item||!id) return false;
  if(type==='character'||type==='speaker') return hasSpeaker(item,id);
  if(type==='skill'){
    const skill=parseSkillId(id);
    return skill?matchesTag(item,skill.axis,skill.value):false;
  }
  if(type==='situation') return Array.isArray(item.situation_tags)&&item.situation_tags.includes(id);
  if(type==='grammar') return Array.isArray(item.grammar_tags)&&item.grammar_tags.includes(id);
  if(type==='construction') return Array.isArray(item.construction_tags)&&item.construction_tags.includes(id);
  if(type==='function') return Array.isArray(item.function_tags)&&item.function_tags.includes(id);
  if(type==='sentence_pattern') return item?.sentence_patterns?.main===id;
  return false;
}

export function makeSearchToken(type,id){
  const prefixes={character:'speaker',speaker:'speaker',situation:'situation',grammar:'grammar',construction:'construction',function:'function'};
  return prefixes[type]&&id?`${prefixes[type]}:${id}`:'';
}

function summarizeItems(items,levelState,now){
  let mastered=0,learning=0,fresh=0,due=0;
  for(const item of items){
    const level=itemLevel(levelState,item.id);
    if(level>=4) mastered+=1;
    else if(level>0) learning+=1;
    else fresh+=1;
    if(itemIsDue(levelState,item.id,now)) due+=1;
  }
  const total=items.length;
  return {total,mastered,learning,fresh,due,mastery:total?Math.round(mastered/total*100):0};
}

function topCharacterThemes(items,{limit=2}={}){
  const counts=new Map();
  for(const item of items){
    for(const id of Array.isArray(item?.situation_tags)?item.situation_tags:[]){
      if(!id||id==='general') continue;
      counts.set(id,(counts.get(id)||0)+1);
    }
  }
  return [...counts.entries()]
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .slice(0,limit)
    .map(([id])=>({id,label:labelForTag('situation',id)}));
}

function addSkillEntries(target,items,field,axis,group,levelState,now){
  const ids=new Set();
  for(const item of items){
    for(const id of Array.isArray(item?.[field])?item[field]:[]){ if(id) ids.add(id); }
  }
  for(const id of ids){
    const matched=items.filter(item=>matchesTag(item,axis,id));
    target.push({
      type:'skill',id:`${axis}:${id}`,axis,rawId:id,group,groupLabel:SKILL_GROUP_META[group].label,
      label:labelForTag(axis,id),...summarizeItems(matched,levelState,now),
    });
  }
}

export function buildTagCatalog(items,characters,levelState={},now=Date.now()){
  const safeItems=Array.isArray(items)?items:[];
  const profiles=Array.isArray(characters)?characters:[];
  const result={character:[],skill:[]};

  for(const profile of profiles){
    const id=profile?.id;
    if(!id) continue;
    const matched=safeItems.filter(item=>hasSpeaker(item,id));
    if(!matched.length) continue;
    result.character.push({
      type:'character',id,label:profile.name||humanize(id),labelJa:profile.name_ja||'',profile,
      themes:topCharacterThemes(matched),...summarizeItems(matched,levelState,now),
    });
  }

  for(const pattern of SENTENCE_PATTERNS){
    const matched=safeItems.filter(item=>matchesTag(item,'sentence_pattern',pattern));
    if(!matched.length) continue;
    result.skill.push({
      type:'skill',id:`sentence_pattern:${pattern}`,axis:'sentence_pattern',rawId:pattern,
      group:'sentence_pattern',groupLabel:SKILL_GROUP_META.sentence_pattern.label,label:pattern,
      ...summarizeItems(matched,levelState,now),
    });
  }
  addSkillEntries(result.skill,safeItems,'grammar_tags','grammar','grammar',levelState,now);
  addSkillEntries(result.skill,safeItems,'construction_tags','construction','construction',levelState,now);

  result.character.sort((a,b)=>{
    const tierA=a.profile?.tier==='main'?0:a.profile?.tier==='supporting'?1:2;
    const tierB=b.profile?.tier==='main'?0:b.profile?.tier==='supporting'?1:2;
    return tierA-tierB||b.total-a.total||a.label.localeCompare(b.label);
  });
  result.skill.sort((a,b)=>{
    const groupDiff=(SKILL_GROUP_META[a.group]?.order??99)-(SKILL_GROUP_META[b.group]?.order??99);
    if(groupDiff) return groupDiff;
    if(a.group==='sentence_pattern') return SENTENCE_PATTERNS.indexOf(a.rawId)-SENTENCE_PATTERNS.indexOf(b.rawId);
    return b.total-a.total||a.label.localeCompare(b.label,'ja');
  });
  return result;
}

export function recommendTags(catalog,{limit=3}={}){
  const pool=[...(catalog?.character||[]),...(catalog?.skill||[])];
  return pool
    .filter(entry=>entry.total>=3)
    .map(entry=>({entry,score:entry.due*9+entry.learning*3+Math.min(entry.fresh,8)+(entry.type==='character'&&entry.profile?.tier==='main'?4:0)-entry.mastery/20}))
    .sort((a,b)=>b.score-a.score||b.entry.total-a.entry.total)
    .slice(0,Math.max(1,limit))
    .map(x=>x.entry);
}

export function examplesForTag(items,type,id,{limit=2}={}){
  return (Array.isArray(items)?items:[]).filter(item=>matchesTag(item,type,id)).slice(0,limit);
}
