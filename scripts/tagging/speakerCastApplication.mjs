function parseFlatTags(raw){
  return String(raw||'')
    .split(',')
    .map(value=>value.trim())
    .filter(Boolean);
}

function sortedObject(entries){
  return Object.fromEntries([...entries].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
}

export function applySpeakerCastPlan(items,plan){
  const safeItems=Array.isArray(items)?items:[];
  const entries=Array.isArray(plan?.entries)?plan.entries:[];
  const byId=new Map(entries.map(entry=>[entry?.item_id,entry]));
  if(entries.length!==safeItems.length) throw new Error(`Speaker cast coverage mismatch: ${entries.length}/${safeItems.length}`);

  return safeItems.map(item=>{
    const entry=byId.get(item?.id);
    if(!entry) throw new Error(`${item?.id||'unknown item'}: missing speaker cast entry`);
    const speakers=(entry.speaker_tags||[]).map(speaker=>({
      id:String(speaker?.id||'').trim(),
      source:String(speaker?.source||'').trim(),
      confidence:String(speaker?.confidence||'').trim(),
    }));
    if(!speakers.length||speakers.some(speaker=>!speaker.id||!speaker.source||!speaker.confidence)){
      throw new Error(`${item.id}: invalid speaker cast payload`);
    }

    const flat=parseFlatTags(item.tags).filter(tag=>!tag.startsWith('speaker:'));
    for(const speaker of speakers) flat.push(`speaker:${speaker.id}`);

    return {
      ...item,
      tags:[...new Set(flat)].join(','),
      speaker_tags:speakers,
    };
  });
}

export function speakerCastReportPatch(items,diagnostics){
  const counts=new Map();
  let taggedItems=0;
  for(const item of Array.isArray(items)?items:[]){
    const speakers=Array.isArray(item?.speaker_tags)?item.speaker_tags:[];
    if(speakers.length) taggedItems+=1;
    for(const speaker of speakers){
      const key=`${speaker.id}:${speaker.source||'unknown'}`;
      counts.set(key,(counts.get(key)||0)+1);
    }
  }
  return {
    speaker_tagged_items:taggedItems,
    speaker_counts:sortedObject(counts),
    speaker_cast_diagnostics:diagnostics||null,
  };
}
