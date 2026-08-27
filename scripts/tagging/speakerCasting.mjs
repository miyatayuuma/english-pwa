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
        return new RegExp(`(?:^|[^A-Za-z])${escaped}(?:[,!.;:]|\\?|\\s|$)`,'i').test(turn);
      });
      if(!matched) continue;
      const profile=profileById.get(characterId);
      if(profile?.voice_presentation===roles[addresseeRole]) locks.set(addresseeRole,characterId);
    }
  }
  return locks;
}

function explicitMentionIds(item){
  return new Set((item?.character_tags||[]).filter(entry=>entry?.certainty==='explicit').map(entry=>entry.id).filter(Boolean));
}

function contextualCharacterStrength(item,characterId){
  let score=0;
  for(const entry of item?.character_tags||[]){
    if(entry?.id!==characterId) continue;
    if(entry.certainty==='inferred_high') score=Math.max(score,4);
    else if(entry.certainty==='inferred_medium') score=Math.max(score,2);
  }
  return score;
}

function affinityScore(profile,item){
  let score=0;
  for(const situation of item?.situation_tags||[]){
    score+=(profile?.situation_affinity?.[situation]||0)*1.8;
  }
  for(const fn of item?.function_tags||[]){
    score+=(profile?.function_affinity?.[fn]||0)*1.2;
  }
  return score;
}

function relationshipScore(castingData,mentionIds,rolePresentation,candidateId){
  let score=0;
  for(const mentionedId of mentionIds){
    score+=castingData?.relationship_hints?.[mentionedId]?.[rolePresentation]?.[candidateId]||0;
  }
  return score;
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

function balanceScore(candidateId,counts,targets){
  const current=counts.get(candidateId)||0;
  const target=Math.max(1,targets.get(candidateId)||1);
  const ratio=current/target;
  return 5*(1-ratio)-2*Math.max(0,ratio-1);
}

function rankCandidates({item,rolePresentation,profiles,counts,targets,castingData,mentionIds,lockedIds}){
  return profiles
    .filter(profile=>profile.voice_presentation===rolePresentation&&!lockedIds.has(profile.id))
    .map(profile=>{
      let score=affinityScore(profile,item);
      score+=relationshipScore(castingData,mentionIds,rolePresentation,profile.id)*2;
      score+=contextualCharacterStrength(item,profile.id);
      score+=balanceScore(profile.id,counts,targets);
      if(mentionIds.has(profile.id)) score-=5;
      score+=stableJitter(item?.id,profile.id);
      return {id:profile.id,score};
    })
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
      const ranked=rankCandidates({
        item,rolePresentation,profiles,counts,targets,castingData,mentionIds,lockedIds,
      });
      if(!ranked.length) throw new Error(`${item.id}: no ${rolePresentation} casting candidate`);
      const best=ranked[0];
      const runnerUp=ranked[1];
      const confidence=!runnerUp||best.score-runnerUp.score>=2.5?'high':'medium';
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
    const roles=voiceRolesFromCode(voiceDataset?.codes_by_item?.[entry.item_id]);
    if(entry.speaker_tags?.length!==roles.length) errors.push(`${entry.item_id}: speaker count does not match voice roles`);
    for(let index=0;index<roles.length;index+=1){
      const speaker=entry.speaker_tags?.[index];
      const profile=profileById.get(speaker?.id);
      if(!profile) errors.push(`${entry.item_id}: unknown character ${speaker?.id||'missing'}`);
      else if(profile.voice_presentation!==roles[index]) errors.push(`${entry.item_id}: ${speaker.id} conflicts with ${roles[index]} audio role`);
      if(!['contextual','app_cast','explicit'].includes(speaker?.source)) errors.push(`${entry.item_id}: invalid speaker source`);
      if(!['high','medium'].includes(speaker?.confidence)) errors.push(`${entry.item_id}: invalid speaker confidence`);
    }
  }
  return errors;
}
