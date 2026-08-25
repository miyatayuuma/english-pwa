export const TAG_TYPES = Object.freeze(['character','situation','grammar','function']);

export const TAG_TYPE_META = Object.freeze({
  character:{ label:'キャラ', prefix:'character' },
  situation:{ label:'場面', prefix:'situation' },
  grammar:{ label:'文法', prefix:'grammar' },
  function:{ label:'表現', prefix:'function' },
});

const SITUATION_LABELS = Object.freeze({
  values_society:'価値観・社会', romance_relationship:'恋愛・関係', family_home:'家族・家庭',
  workplace_career:'仕事・キャリア', school_education:'学校・教育', travel_transport:'旅行・移動',
  shopping_money:'買い物・お金', food_dining:'食事', health_medical:'健康・医療',
  science_technology:'科学・技術', politics_government:'政治・行政', law_crime:'法律・犯罪',
  war_conflict:'戦争・対立', environment_geography:'環境・地理', arts_culture:'芸術・文化',
  social_communication:'会話・交流', personality_emotion:'性格・感情', religion_funeral:'宗教・葬儀',
  danger_disaster:'危険・災害', leisure_hobby:'趣味・余暇', general:'一般'
});

const GRAMMAR_LABELS = Object.freeze({
  modal_must:'must', modal_should:'should', modal_can:'can', modal_could:'could', modal_may_might:'may / might',
  modal_would:'would', future_will:'will', have_to:'have to', be_going_to:'be going to',
  if_or_unless_clause:'if / unless', subjunctive:'仮定法', inversion_no_sooner:'倒置',
  correlative_comparative:'比較構文', not_so_much_as:'not so much A as B', relative_clause:'関係詞',
  there_be:'there is / are', it_that_structure:'It ... that', present_perfect:'現在完了',
  past_perfect:'過去完了', present_progressive:'現在進行形', past_progressive:'過去進行形',
  passive_voice:'受動態', imperative:'命令文', question:'疑問文', reported_speech:'話法',
  subordinate_clause:'従属節', participial_or_reduced_clause:'分詞・省略節', causative_have:'使役 have'
});

const FUNCTION_LABELS = Object.freeze({
  asking:'質問', requesting:'依頼', advising:'助言', opinion:'意見', apology:'謝罪', gratitude:'感謝',
  encouragement:'励まし', complaint_or_protest:'不満・抗議', reason_or_result:'理由・結果'
});

export function labelForTag(type,id){
  if(type==='situation') return SITUATION_LABELS[id] || humanize(id);
  if(type==='grammar') return GRAMMAR_LABELS[id] || humanize(id);
  if(type==='function') return FUNCTION_LABELS[id] || humanize(id);
  return humanize(id);
}

function humanize(value){
  return String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
}

export function itemLevel(levelState,itemId){
  const raw=levelState && levelState[itemId];
  if(!raw || typeof raw!=='object') return 0;
  const last=Number(raw.last);
  const best=Number(raw.best);
  if(Number.isFinite(last)) return Math.max(0,Math.min(5,last));
  if(Number.isFinite(best)) return Math.max(0,Math.min(5,best));
  return 0;
}

export function itemIsDue(levelState,itemId,now=Date.now()){
  const raw=levelState && levelState[itemId];
  if(!raw || typeof raw!=='object') return false;
  const level=itemLevel(levelState,itemId);
  if(level<=0) return false;
  const nextDueAt=Number(raw.review?.nextDueAt ?? raw.nextDueAt ?? 0);
  return Number.isFinite(nextDueAt) && nextDueAt>0 && nextDueAt<=now;
}

export function characterCertainty(item,characterId){
  const tags=Array.isArray(item?.character_tags) ? item.character_tags : [];
  const hit=tags.find(tag=>tag && tag.id===characterId);
  return hit?.certainty || null;
}

export function matchesTag(item,type,id,{includeMedium=true}={}){
  if(!item || !id) return false;
  if(type==='character'){
    const certainty=characterCertainty(item,id);
    if(!certainty) return false;
    return includeMedium || certainty!=='inferred_medium';
  }
  const field=type==='situation'?'situation_tags':type==='grammar'?'grammar_tags':type==='function'?'function_tags':null;
  return field ? Array.isArray(item[field]) && item[field].includes(id) : false;
}

export function makeSearchToken(type,id){
  const meta=TAG_TYPE_META[type];
  return meta && id ? `${meta.prefix}:${id}` : '';
}

function summarizeItems(items,levelState,now){
  let mastered=0, learning=0, fresh=0, due=0;
  for(const item of items){
    const level=itemLevel(levelState,item.id);
    if(level>=4) mastered+=1;
    else if(level>0) learning+=1;
    else fresh+=1;
    if(itemIsDue(levelState,item.id,now)) due+=1;
  }
  const total=items.length;
  const mastery=total ? Math.round(mastered/total*100) : 0;
  return { total, mastered, learning, fresh, due, mastery };
}

export function buildTagCatalog(items,characters,levelState={},now=Date.now()){
  const safeItems=Array.isArray(items)?items:[];
  const profiles=Array.isArray(characters)?characters:[];
  const profileMap=new Map(profiles.map(profile=>[profile.id,profile]));
  const result={ character:[], situation:[], grammar:[], function:[] };

  // Character mode intentionally exposes only curated profiles. items.json also
  // contains one-off proper names whose single sentence does not support a useful
  // character identity; those remain searchable but are not promoted to the mode.
  for(const profile of profiles){
    const id=profile?.id;
    if(!id) continue;
    const matched=safeItems.filter(item=>matchesTag(item,'character',id,{includeMedium:true}));
    if(!matched.length) continue;
    const core=matched.filter(item=>matchesTag(item,'character',id,{includeMedium:false}));
    const medium=matched.length-core.length;
    result.character.push({
      type:'character', id, label:profile.name||humanize(id), labelJa:profile.name_ja||'',
      profile, coreTotal:core.length, relatedTotal:medium, ...summarizeItems(matched,levelState,now)
    });
  }

  for(const type of ['situation','grammar','function']){
    const field=type==='situation'?'situation_tags':type==='grammar'?'grammar_tags':'function_tags';
    const ids=new Set();
    for(const item of safeItems){
      for(const id of Array.isArray(item[field])?item[field]:[]){ if(id) ids.add(id); }
    }
    for(const id of ids){
      const matched=safeItems.filter(item=>matchesTag(item,type,id));
      result[type].push({ type,id,label:labelForTag(type,id),...summarizeItems(matched,levelState,now) });
    }
  }

  result.character.sort((a,b)=>{
    const tierA=a.profile?.tier==='main'?0:1;
    const tierB=b.profile?.tier==='main'?0:1;
    return tierA-tierB || b.total-a.total || a.label.localeCompare(b.label);
  });
  result.situation.sort((a,b)=>(a.id==='general'?1:0)-(b.id==='general'?1:0) || b.total-a.total || a.label.localeCompare(b.label,'ja'));
  result.grammar.sort((a,b)=>b.total-a.total || a.label.localeCompare(b.label,'ja'));
  result.function.sort((a,b)=>b.total-a.total || a.label.localeCompare(b.label,'ja'));
  return result;
}

export function recommendTags(catalog,{limit=3}={}){
  const pool=[...(catalog?.character||[]),...(catalog?.situation||[]).filter(x=>x.id!=='general'),...(catalog?.grammar||[])];
  return pool
    .filter(entry=>entry.total>=3)
    .map(entry=>({entry, score:entry.due*9 + entry.learning*3 + Math.min(entry.fresh,8) + (entry.type==='character'&&entry.profile?.tier==='main'?4:0) - entry.mastery/20}))
    .sort((a,b)=>b.score-a.score || b.entry.total-a.entry.total)
    .slice(0,Math.max(1,limit))
    .map(x=>x.entry);
}

export function examplesForTag(items,type,id,{limit=2,includeMedium=true}={}){
  return (Array.isArray(items)?items:[]).filter(item=>matchesTag(item,type,id,{includeMedium})).slice(0,limit);
}
