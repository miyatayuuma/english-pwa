import { voiceRolesFromCode } from './audioVoiceTaxonomy.mjs';

function stableJitter(itemId,characterId){
  const text=`${itemId}:${characterId}`;
  let hash=2166136261;
  for(let i=0;i<text.length;i+=1){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return ((hash>>>0)%1000)/100000;
}

function normalizeName(value){
  return String(value||'').trim();
}

export function buildCharacterNameMap(characterData){
  const byId=new Map();
  for(const character of characterData?.characters||[]){
    const names=[character?.name,character?.name_ja].map(normalizeName).filter(Boolean);
    if(character?.id&&names.length) byId.set(character.id,names);
  }
  return byId;
}

export function quotedTurns(text){
  const source=String(text||'');
  const turns=[];
  const regex=/"([^"]+)"/g;
  let match;
  while((match=regex.exec(source))) turns.push(match[1].trim());
  return turns;
}

function directAddresseeLocks(item,roles,nameMap,profileById){
  if(roles.length!==2) return new Map();
  const turns=quotedTurns(item?.en);
  if(turns.length<2) return new Map();
  const locks=new Map();
  for(let index=0;index<turns.length;index+=1){
    const speakerRole=index%2;
    const addresseeRole=speakerRole===0?1:0;
    const turn=turns[index];
    for(const [characterId,names] of nameMap){
      const matched=names.some(name=>{
        if(!/^[A-Za-z .'-]+$/.test(name)) return false;
        const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        return new RegExp(`(?:^|[,;]\\s*)${escaped}(?:[,!.;:]|\\?|$)`,'i').test(turn);
      });
      if(!matched) continue;
      const profile=profileById.get(characterId);
      if(profile?.voice_presentation===roles[addresseeRole]) locks.set(addresseeRole,characterId);
    }
  }
  return locks;
}

function contextualOverrideLocks(itemId,roles,castingData,profileById){
  const locks=new Map();
  const raw=castingData?.contextual_speaker_overrides?.[itemId]||{};
  for(const [rawIndex,rawId] of Object.entries(raw)){
    const roleIndex=Number(rawIndex);
    const characterId=String(rawId||'').trim();
    if(!Number.isInteger(roleIndex)||roleIndex<0||roleIndex>=roles.length) continue;
    const profile=profileById.get(characterId);
    if(profile?.voice_presentation===roles[roleIndex]) locks.set(roleIndex,characterId);
  }
  return locks;
}

function explicitMentionIds(item){
  return new Set((item?.mentioned_character_tags||[]).map(entry=>entry?.id).filter(Boolean));
}

function numeric(value,fallback){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
}

function situationScore(profile,item,castingData){
  const weight=numeric(castingData?.scoring?.situation_weight,1.8);
  return (item?.situation_tags||[]).reduce((sum,id)=>sum+(profile?.situation_affinity?.[id]||0)*weight,0);
}

function functionScore(profile,item,castingData){
  const weight=numeric(castingData?.scoring?.function_weight,0.4);
  return (item?.function_tags||[]).reduce((sum,id)=>sum+(profile?.function_affinity?.[id]||0)*weight,0);
}

function cueScore(profile,item,castingData){
  const weight=numeric(castingData?.scoring?.cue_weight,3);
  const text=String(item?.en||'');
  let matches=0;
  for(const source of profile?.cue_patterns||[]){
    try{
      if(new RegExp(source,'i').test(text)) matches+=1;
    }catch(_){ /* invalid profile cue is ignored; config validation catches missing utility later */ }
  }
  return matches*weight;
}

function relationshipScore(castingData,mentionIds,rolePresentation,candidateId){
  const weight=numeric(castingData?.scoring?.relationship_weight,2.2);
  let raw=0;
  for(const mentionedId of mentionIds){
    raw+=castingData?.relationship_hints?.[mentionedId]?.[rolePresentation]?.[candidateId]||0;
  }
  return raw*weight;
}

function targetCounts(items,voiceCodes,castingData){
  const slotTotals={masculine:0,feminine:0};
  for(const item of items||[]){
    for(const role of voiceRolesFromCode(voiceCodes?.[item.id])){
      if(role in slotTotals) slotTotals[role]+=1;
    }
  }
  const profiles=castingData?.characters||[];
  const result=new Map();
  for(const presentation of Object.keys(slotTotals)){
    const group=profiles.filter(profile=>profile.voice_presentation===presentation);
    const totalWeight=group.reduce((sum,profile)=>sum+(castingData?.tier_weights?.[profile.tier]||1),0)||1;
    for(const profile of group){
      const weight=castingData?.tier_weights?.[profile.tier]||1;
      result.set(profile.id,slotTotals[presentation]*weight/totalWeight);
    }
  }
  return result;
}

function balanceScore(candidateId,counts,targets,castingData){
  const weight=numeric(castingData?.scoring?.balance_weight,3);
  const current=counts.get(candidateId)||0;
  const target=Math.max(1,targets.get(candidateId)||1);
  const ratio=current/target;
  return weight*((1-ratio)-0.5*Math.max(0,ratio-1));
}

function rankedCandidates({item,rolePresentation,profiles,counts,targets,castingData,mentionIds,lockedIds}){
  const candidates=[];
  for(const profile of profiles){
    if(profile.voice_presentation!==rolePresentation||lockedIds.has(profile.id)||mentionIds.has(profile.id)) continue;
    const situation=situationScore(profile,item,castingData);
    const fn=functionScore(profile,item,castingData);
    const cue=cueScore(profile,item,castingData);
    const relationship=relationshipScore(castingData,mentionIds,rolePresentation,profile.id);
    const semantic=situation+fn+cue+relationship;
    const topical=situation>0||cue>0||relationship>0;
    if(profile.generalist===false&&!topical) continue;
    candidates.push({id:profile.id,semantic,topical});
  }
  if(!candidates.length) return [];
  const positive=candidates.filter(candidate=>candidate.semantic>0);
  let eligible=positive.length?positive:candidates.filter(candidate=>profiles.find(profile=>profile.id===candidate.id)?.generalist!==false);
  if(!eligible.length) eligible=candidates;
  return eligible
    .map(candidate=>({
      ...candidate,
      score:candidate.semantic+balanceScore(candidate.id,counts,targets,castingData)+stableJitter(item?.id,candidate.id),
    }))
    .sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}

export function buildSpeakerCastPlan(items,voiceDataset,castingData,characterData){
  const safeItems=Array.isArray(items)?items:[];
  const codes=voiceDataset?.codes_by_item||{};
  const profiles=Array.isArray(castingData?.characters)?castingData.characters:[];
  const profileById=new Map(profiles.map(profile=>[profile.id,profile]));
  const nameMap=buildCharacterNameMap(characterData);
  const targets=targetCounts(safeItems,codes,castingData);
  const counts=new Map(profiles.map(profile=>[profile.id,0]));
  const plan=[];

  for(const item of safeItems){
    const audioCode=String(codes[item.id]||'').trim().toLowerCase();
    const roles=voiceRolesFromCode(audioCode);
    if(!roles.length) throw new Error(`${item.id}: missing valid audio voice code`);
    const locks=directAddresseeLocks(item,roles,nameMap,profileById);
    for(const [roleIndex,characterId] of contextualOverrideLocks(item.id,roles,castingData,profileById)){
      locks.set(roleIndex,characterId);
    }
    const mentionIds=explicitMentionIds(item);
    const selected=[];
    const lockedIds=new Set();

    for(let roleIndex=0;roleIndex<roles.length;roleIndex+=1){
      const rolePresentation=roles[roleIndex];
      const lockedId=locks.get(roleIndex);
      if(lockedId){
        selected.push({id:lockedId,source:'contextual',confidence:'high'});
        lockedIds.add(lockedId);
        counts.set(lockedId,(counts.get(lockedId)||0)+1);
        continue;
      }
      const ranked=rankedCandidates({
        item,rolePresentation,profiles,counts,targets,castingData,mentionIds,lockedIds,
      });
      if(!ranked.length) throw new Error(`${item.id}: no ${rolePresentation} casting candidate`);
      const best=ranked[0];
      const runnerUp=ranked[1];
      const margin=numeric(castingData?.scoring?.high_confidence_margin,2.5);
      const confidence=!runnerUp||best.score-runnerUp.score>=margin?'high':'medium';
      selected.push({id:best.id,source:'app_cast',confidence});
      lockedIds.add(best.id);
      counts.set(best.id,(counts.get(best.id)||0)+1);
    }

    plan.push({item_id:item.id,audio_code:audioCode,speaker_tags:selected});
  }

  return {
    schema_version:1,
    purpose:'draft app speaker casting; app_cast is not source canon',
    entries:plan,
    diagnostics:summarizeCastPlan(plan,castingData,targets),
  };
}

export function summarizeCastPlan(entriesOrPlan,castingData,targetsInput=null){
  const entries=Array.isArray(entriesOrPlan)?entriesOrPlan:(entriesOrPlan?.entries||[]);
  const counts={};
  const sourceCounts={};
  const confidenceCounts={};
  for(const entry of entries){
    for(const speaker of entry?.speaker_tags||[]){
      counts[speaker.id]=(counts[speaker.id]||0)+1;
      sourceCounts[speaker.source]=(sourceCounts[speaker.source]||0)+1;
      confidenceCounts[speaker.confidence]=(confidenceCounts[speaker.confidence]||0)+1;
    }
  }
  const targets={};
  if(targetsInput instanceof Map){
    for(const [id,value] of targetsInput) targets[id]=Number(value.toFixed(2));
  }else{
    for(const profile of castingData?.characters||[]) targets[profile.id]=null;
  }
  return {
    item_count:entries.length,
    speaker_slot_count:Object.values(counts).reduce((sum,value)=>sum+value,0),
    character_counts:Object.fromEntries(Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))),
    target_counts:targets,
    source_counts:sourceCounts,
    confidence_counts:confidenceCounts,
  };
}

export function validateSpeakerCastPlan(plan,items,voiceDataset,castingData){
  const errors=[];
  const entries=plan?.entries||[];
  const itemById=new Map((items||[]).map(item=>[item.id,item]));
  const profileById=new Map((castingData?.characters||[]).map(profile=>[profile.id,profile]));
  if(entries.length!==itemById.size) errors.push(`expected ${itemById.size} cast entries, got ${entries.length}`);
  const seen=new Set();
  for(const entry of entries){
    if(seen.has(entry.item_id)) errors.push(`${entry.item_id}: duplicate cast entry`);
    seen.add(entry.item_id);
    const item=itemById.get(entry.item_id);
    if(!item){ errors.push(`${entry.item_id}: missing item`); continue; }
    const explicitMentions=explicitMentionIds(item);
    const roles=voiceRolesFromCode(voiceDataset?.codes_by_item?.[entry.item_id]);
    if(entry.speaker_tags?.length!==roles.length) errors.push(`${entry.item_id}: speaker count does not match voice roles`);
    for(let index=0;index<roles.length;index+=1){
      const speaker=entry.speaker_tags?.[index];
      const profile=profileById.get(speaker?.id);
      if(!profile) errors.push(`${entry.item_id}: unknown character ${speaker?.id||'missing'}`);
      else if(profile.voice_presentation!==roles[index]) errors.push(`${entry.item_id}: ${speaker.id} conflicts with ${roles[index]} audio role`);
      if(!['contextual','app_cast','explicit'].includes(speaker?.source)) errors.push(`${entry.item_id}: invalid speaker source`);
      if(!['high','medium'].includes(speaker?.confidence)) errors.push(`${entry.item_id}: invalid speaker confidence`);
      if(speaker?.source==='app_cast'&&explicitMentions.has(speaker.id)) errors.push(`${entry.item_id}: app-cast speaker duplicates an explicitly mentioned character`);
    }
  }
  return errors;
}
