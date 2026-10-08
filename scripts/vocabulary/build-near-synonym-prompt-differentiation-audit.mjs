import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const AUDIT_DIR=path.join(ROOT,'data/audits/vocabulary-near-synonym-prompt-differentiation');
const BASE_MAIN='f448394e3052c686d8cad97912c3b779345b758e';
const INPUTS=[
  'data/vocabulary-v3.json',
  'data/vocabulary-v3-paraphrase-audit.json',
  'data/vocabulary-v3-final-admission-authority.json',
  'data/audits/vocabulary-v3-meaning-canonical/manifest.json',
  'data/audits/vocabulary-v3-meaning-canonical/reconciliation.json',
  'data/audits/vocabulary-v3-paraphrase-learning/manifest.json',
  'data/audits/vocabulary-v3-paraphrase-learning/summary.json',
  'data/audits/vocabulary-paraphrase-rule-consistency/manifest.json',
  'data/audits/vocabulary-paraphrase-rule-consistency/candidates.json',
  'data/audits/vocabulary-paraphrase-rule-consistency/confirmed.json',
  'data/audits/vocabulary-paraphrase-rule-consistency/false-positive.json',
  'data/audits/vocabulary-paraphrase-rule-consistency/review.json',
  'data/audits/vocabulary-paraphrase-rule-consistency/materialization.json',
  'data/audits/vocabulary-grammar-role/manifest.json',
  'data/audits/vocabulary-grammar-role/final-resolutions.json',
];
const CLASSIFICATIONS=['KEEP','PROMPT_QUALIFIER','PROMPT_AND_PARAPHRASE','UPSTREAM_AUTHORITY_REVIEW'];

const readJson=(relative)=>JSON.parse(fs.readFileSync(path.join(ROOT,relative),'utf8'));
const sha256=(buffer)=>crypto.createHash('sha256').update(buffer).digest('hex');
const normPrompt=(value)=>String(value??'').normalize('NFKC').replace(/\s+/gu,' ').trim();
const normEnglish=(value)=>String(value??'').normalize('NFKC').toLocaleLowerCase('en-US')
  .replace(/[’‘‛ʼ＇]/gu,"'").replace(/[‐‑‒–—―−﹘﹣－]/gu,'-')
  .replace(/'/gu,'').replace(/\s*-\s*/gu,'-').replace(/\p{P}/gu,' ').replace(/\s+/gu,' ').trim();
const grams=(value)=>{
  const chars=Array.from(normPrompt(value).toLocaleLowerCase('ja-JP').replace(/\s/gu,''));
  if(chars.length<2) return new Set(chars);
  return new Set(chars.slice(0,-1).map((char,index)=>char+chars[index+1]));
};
const dice=(left,right)=>{
  const a=grams(left),b=grams(right);
  if(!a.size&&!b.size) return 1;
  let shared=0; for(const value of a) if(b.has(value)) shared++;
  return (2*shared)/(a.size+b.size);
};
const numericId=(id)=>Number(String(id).split(':')[1]);
const pairKey=(a,b)=>[a.id,b.id].sort((x,y)=>numericId(x)-numericId(y)).join('|');
const pairIds=(key)=>key.split('|');
const canonicalKey=(entry)=>normEnglish(entry.canonical);

function sourceSnapshots(){
  return Object.fromEntries(INPUTS.map(relative=>{
    const bytes=fs.readFileSync(path.join(ROOT,relative));
    const gitObject=Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes]);
    return [relative,{sha256:sha256(bytes),git_blob_sha:crypto.createHash('sha1').update(gitObject).digest('hex')}];
  }));
}

function extract(){
  const production=readJson('data/vocabulary-v3.json');
  const entries=production.entries;
  const byId=new Map(entries.map(entry=>[entry.id,entry]));
  const edgeMap=new Map();
  const addEdge=(left,right,type,details={})=>{
    if(left.id===right.id) return;
    const key=pairKey(left,right);
    if(!edgeMap.has(key)) edgeMap.set(key,{pair_ids:pairIds(key),sources:[],prompt_similarity:null,shared_paraphrases:[],canonical_overlap_directions:[]});
    const edge=edgeMap.get(key);
    if(!edge.sources.includes(type)) edge.sources.push(type);
    if(details.similarity!==undefined) edge.prompt_similarity=Math.max(edge.prompt_similarity??0,details.similarity);
    if(details.paraphrase) edge.shared_paraphrases.push(details.paraphrase);
    if(details.direction) edge.canonical_overlap_directions.push(details.direction);
  };

  const exactGroups=new Map();
  for(const entry of entries){
    const key=normPrompt(entry.meaning_ja);
    if(!exactGroups.has(key)) exactGroups.set(key,[]);
    exactGroups.get(key).push(entry);
  }
  for(const group of exactGroups.values()){
    if(new Set(group.map(canonicalKey)).size<2) continue;
    for(let i=0;i<group.length;i++) for(let j=i+1;j<group.length;j++) addEdge(group[i],group[j],'exact_prompt');
  }

  const senseGroups=new Map();
  for(const entry of entries){
    if(!entry.sense_key) continue;
    if(!senseGroups.has(entry.sense_key)) senseGroups.set(entry.sense_key,[]);
    senseGroups.get(entry.sense_key).push(entry);
  }
  for(const group of senseGroups.values()){
    if(new Set(group.map(canonicalKey)).size<2) continue;
    for(let i=0;i<group.length;i++) for(let j=i+1;j<group.length;j++){
      if(canonicalKey(group[i])!==canonicalKey(group[j])) addEdge(group[i],group[j],'same_sense_key');
    }
  }

  const byCanonical=new Map();
  for(const entry of entries){
    const key=normEnglish(entry.canonical);
    if(!byCanonical.has(key)) byCanonical.set(key,[]);
    byCanonical.get(key).push(entry);
  }
  const directOverlapPairs=new Set();
  for(const entry of entries){
    for(const paraphrase of entry.paraphrases||[]){
      for(const canonicalEntry of byCanonical.get(normEnglish(paraphrase))||[]){
        if(canonicalEntry.id===entry.id||canonicalKey(canonicalEntry)===canonicalKey(entry)) continue;
        const key=pairKey(canonicalEntry,entry);
        directOverlapPairs.add(key);
        const sim=dice(canonicalEntry.meaning_ja,entry.meaning_ja);
        const sameRole=canonicalEntry.grammarRole===entry.grammarRole;
        const sameSense=Boolean(canonicalEntry.sense_key&&canonicalEntry.sense_key===entry.sense_key);
        if(sameRole&&(sameSense||sim>=0.35)){
          addEdge(canonicalEntry,entry,'near_prompt_or_shared_sense',{similarity:sim});
          edgeMap.get(key).canonical_overlap_directions.push({
            accepted_by_entry_id:entry.id, accepted_surface:paraphrase, canonical_entry_id:canonicalEntry.id,
          });
        }
      }
    }
  }

  const paraphraseOwners=new Map();
  for(const entry of entries){
    for(const paraphrase of new Set((entry.paraphrases||[]).map(normEnglish).filter(Boolean))){
      if(!paraphraseOwners.has(paraphrase)) paraphraseOwners.set(paraphrase,new Set());
      paraphraseOwners.get(paraphrase).add(entry.id);
    }
  }
  const overlapCounts=new Map();
  for(const [paraphrase,owners] of paraphraseOwners){
    const ownerIds=[...owners].sort((a,b)=>numericId(a)-numericId(b));
    for(let i=0;i<ownerIds.length;i++) for(let j=i+1;j<ownerIds.length;j++){
      const left=byId.get(ownerIds[i]),right=byId.get(ownerIds[j]);
      if(canonicalKey(left)===canonicalKey(right)) continue;
      const key=pairKey(left,right);
      if(!overlapCounts.has(key)) overlapCounts.set(key,new Set());
      overlapCounts.get(key).add(paraphrase);
    }
  }
  for(const [key,overlaps] of overlapCounts){
    if(overlaps.size<2) continue;
    const [leftId,rightId]=pairIds(key),left=byId.get(leftId),right=byId.get(rightId);
    for(const paraphrase of overlaps) addEdge(left,right,'shared_paraphrases_ge_2',{paraphrase});
  }

  const adjacency=new Map();
  for(const {pair_ids:[left,right]} of edgeMap.values()){
    if(!adjacency.has(left)) adjacency.set(left,new Set());
    if(!adjacency.has(right)) adjacency.set(right,new Set());
    adjacency.get(left).add(right); adjacency.get(right).add(left);
  }
  const components=[]; const visited=new Set();
  for(const first of [...adjacency.keys()].sort((a,b)=>numericId(a)-numericId(b))){
    if(visited.has(first)) continue;
    const component=[]; const stack=[first]; visited.add(first);
    while(stack.length){
      const current=stack.pop(); component.push(current);
      for(const next of adjacency.get(current)||[]){
        if(!visited.has(next)){visited.add(next);stack.push(next);}
      }
    }
    component.sort((a,b)=>numericId(a)-numericId(b));
    if(new Set(component.map(id=>canonicalKey(byId.get(id)))).size>1) components.push(component);
  }
  components.sort((a,b)=>numericId(a[0])-numericId(b[0]));
  const groups=components.map((ids,index)=>{
    const groupId=`NSD-${String(numericId(ids[0])).padStart(5,'0')}-${String(numericId(ids.at(-1))).padStart(5,'0')}`;
    const idSet=new Set(ids);
    const edges=[...edgeMap.values()].filter(edge=>edge.pair_ids.every(id=>idSet.has(id)))
      .map(edge=>({...edge,sources:[...edge.sources].sort(),shared_paraphrases:[...new Set(edge.shared_paraphrases)].sort(),canonical_overlap_directions:edge.canonical_overlap_directions
        .filter((row,index,array)=>array.findIndex(other=>JSON.stringify(other)===JSON.stringify(row))===index)}))
      .sort((a,b)=>numericId(a.pair_ids[0])-numericId(b.pair_ids[0])||numericId(a.pair_ids[1])-numericId(b.pair_ids[1]));
    const groupEntries=ids.map(id=>byId.get(id));
    const distinctPrompts=[...new Set(groupEntries.map(entry=>entry.meaning_ja))];
    const commonPrompts=distinctPrompts.filter(prompt=>groupEntries.every(entry=>normPrompt(entry.meaning_ja)===normPrompt(prompt)));
    const candidateTypes=[...new Set(edges.flatMap(edge=>edge.sources))].sort();
    const sharedStrings=[...new Set(edges.flatMap(edge=>edge.shared_paraphrases))].sort();
    const directPairs=edges.filter(edge=>edge.canonical_overlap_directions.length).length;
    const groupSnapshot=groupEntries.map(entry=>({
      id:entry.id,canonical:entry.canonical,kind:entry.kind||null,subtype:entry.subtype||null,
      grammarRole:entry.grammarRole||null,pos:entry.pos||null,meaning_ja:entry.meaning_ja||'',sense_key:entry.sense_key||null,
      paraphrases:[...(entry.paraphrases||[])],
    }));
    return {
      group_id:groupId,
      extraction_index:index+1,
      shared_or_near_prompt:distinctPrompts.length===1?distinctPrompts[0]:distinctPrompts,
      prompt_variants:distinctPrompts,
      entries:groupSnapshot,
      candidate_sources:candidateTypes,
      semantic_relationship:'',
      nuance_dimensions:[],
      classification:null,
      recommended_prompt:{},
      recommended_paraphrases:{},
      removed_paraphrases:{},
      added_paraphrases:{},
      reason:'',
      confidence:null,
      evidence_notes:[],
      cross_entry_edges:edges,
      discovery_stats:{edge_count:edges.length,direct_canonical_overlap_pair_count:directPairs,shared_paraphrase_strings:sharedStrings},
    };
  });

  const groupByEntry=new Map();
  for(const group of groups) for(const entry of group.entries) groupByEntry.set(entry.id,group.group_id);
  const directEdges=[...directOverlapPairs].map(key=>{
    const [leftId,rightId]=pairIds(key),left=byId.get(leftId),right=byId.get(rightId);
    const groupId=groupByEntry.get(leftId)===groupByEntry.get(rightId)?groupByEntry.get(leftId):null;
    const sim=dice(left.meaning_ja,right.meaning_ja);
    const sameRole=left.grammarRole===right.grammarRole;
    const sameSense=Boolean(left.sense_key&&left.sense_key===right.sense_key);
    return {pair_ids:[leftId,rightId],canonical:[left.canonical,right.canonical],prompts:[left.meaning_ja,right.meaning_ja],grammar_roles:[left.grammarRole,right.grammarRole],sense_keys:[left.sense_key||null,right.sense_key||null],prompt_similarity:Number(sim.toFixed(4)),group_id:groupId,triage:groupId?'reviewed_in_candidate_group':'screened_out',screen_reason:groupId?null:(sameRole&&sameSense?'':'No exact/near Japanese prompt or shared sense key; direct accepted-form overlap alone does not establish a prompt collision.')};
  }).sort((a,b)=>numericId(a.pair_ids[0])-numericId(b.pair_ids[0])||numericId(a.pair_ids[1])-numericId(b.pair_ids[1]));
  const allSharedPairs=[...overlapCounts.entries()].map(([key,overlaps])=>{
    const [leftId,rightId]=pairIds(key),left=byId.get(leftId),right=byId.get(rightId);
    const groupId=groupByEntry.get(leftId)===groupByEntry.get(rightId)?groupByEntry.get(leftId):null;
    return {pair_ids:[leftId,rightId],canonical:[left.canonical,right.canonical],prompts:[left.meaning_ja,right.meaning_ja],shared_paraphrases:[...overlaps].sort(),shared_count:overlaps.size,group_id:groupId,triage:groupId?'reviewed_in_candidate_group':'screened_out',screen_reason:groupId?null:(overlaps.size<2?'Only one shared surface; below the audit’s multi-overlap candidate threshold.':'No prompt/sense match; overlapping paraphrases point to other senses or broad answers.')};
  }).sort((a,b)=>numericId(a.pair_ids[0])-numericId(b.pair_ids[0])||numericId(a.pair_ids[1])-numericId(b.pair_ids[1]));
  const exactPromptCount=[...exactGroups.values()].filter(group=>new Set(group.map(canonicalKey)).size>1).length;
  const sameSenseCount=[...senseGroups.values()].filter(group=>new Set(group.map(canonicalKey)).size>1).length;
  const nearPairs=directEdges.filter(edge=>edge.group_id&&edge.prompt_similarity>=0.35&&!edge.prompts.every(prompt=>normPrompt(prompt)===normPrompt(edge.prompts[0]))&&edge.sense_keys[0]!==edge.sense_keys[1]);
  return {
    production,entries,groups,groupByEntry,directEdges,allSharedPairs,
    sourceSnapshots:sourceSnapshots(),
    extraction:{population:entries.length,exact_prompt_collision_groups:exactPromptCount,same_sense_key_groups:sameSenseCount,direct_canonical_overlap_pairs:directEdges.length,shared_paraphrase_pairs:allSharedPairs.length,shared_paraphrase_pairs_ge_2:allSharedPairs.filter(edge=>edge.shared_count>=2).length,near_prompt_pair_count:nearPairs.length},
  };
}

function applyDecisions(extracted){
  const decisionPath=path.join(AUDIT_DIR,'decisions.json');
  const decisions=JSON.parse(fs.readFileSync(decisionPath,'utf8'));
  const byId=new Map(extracted.entries.map(entry=>[entry.id,entry]));
  const knownGroups=new Set(extracted.groups.map(group=>group.group_id));
  const unknown=Object.keys(decisions).filter(id=>!knownGroups.has(id));
  const missing=[...knownGroups].filter(id=>!Object.hasOwn(decisions,id));
  if(unknown.length||missing.length) throw new Error(`decision coverage mismatch: missing=${missing.join(',')} unknown=${unknown.join(',')}`);
  for(const group of extracted.groups){
    const decision=decisions[group.group_id];
    if(!CLASSIFICATIONS.includes(decision.classification)) throw new Error(`${group.group_id}: invalid classification`);
    const currentById=new Map(group.entries.map(entry=>[entry.id,entry]));
    group.classification=decision.classification;
    group.semantic_relationship=decision.semantic_relationship;
    group.nuance_dimensions=decision.nuance_dimensions||[];
    group.recommended_prompt=decision.recommended_prompt||{};
    group.recommended_paraphrases=decision.recommended_paraphrases||{};
    group.reason=decision.reason;
    group.confidence=decision.confidence;
    group.evidence_notes=decision.evidence_notes||[];
    group.spelling_variant_notes=decision.spelling_variant_notes||[];
    for(const [id,recommended] of Object.entries(group.recommended_paraphrases)){
      if(!currentById.has(id)) throw new Error(`${group.group_id}: unknown paraphrase target ${id}`);
      if(!Array.isArray(recommended)) throw new Error(`${group.group_id}/${id}: recommended paraphrases must be an array`);
      const before=currentById.get(id).paraphrases;
      group.removed_paraphrases[id]=before.filter(value=>!recommended.some(item=>normEnglish(item)===normEnglish(value)));
      group.added_paraphrases[id]=recommended.filter(value=>!before.some(item=>normEnglish(item)===normEnglish(value)));
    }
    if(group.classification==='KEEP'&&(Object.keys(group.recommended_prompt).length||Object.keys(group.recommended_paraphrases).length)) throw new Error(`${group.group_id}: KEEP must not recommend production changes`);
    if(group.classification==='PROMPT_QUALIFIER'&&(!Object.keys(group.recommended_prompt).length||Object.keys(group.recommended_paraphrases).length)) throw new Error(`${group.group_id}: PROMPT_QUALIFIER requires prompt-only recommendations`);
    if(group.classification==='PROMPT_AND_PARAPHRASE'){
      if(!Object.keys(group.recommended_prompt).length||!Object.keys(group.recommended_paraphrases).length) throw new Error(`${group.group_id}: C requires prompt and paraphrase recommendations`);
      const diff=Object.values(group.removed_paraphrases).flat().length+Object.values(group.added_paraphrases).flat().length;
      if(!diff) throw new Error(`${group.group_id}: C has no explicit paraphrase diff`);
    }
    if(group.classification==='UPSTREAM_AUTHORITY_REVIEW'&&(Object.keys(group.recommended_prompt).length||Object.keys(group.recommended_paraphrases).length)) throw new Error(`${group.group_id}: D cannot assert remediation recommendations`);
    for(const [id,prompt] of Object.entries(group.recommended_prompt)){
      if(!currentById.has(id)||typeof prompt!=='string'||!prompt.trim()) throw new Error(`${group.group_id}: invalid prompt recommendation for ${id}`);
    }
  }
  return extracted;
}

function buildOutputs(extracted){
  const {groups,extraction,sourceSnapshots}=extracted;
  const changedGroups=groups.filter(group=>group.classification!=='KEEP');
  const cGroups=groups.filter(group=>group.classification==='PROMPT_AND_PARAPHRASE');
  const entriesAffected=[...new Set(changedGroups.flatMap(group=>[...Object.keys(group.recommended_prompt),...Object.keys(group.recommended_paraphrases)]))];
  const removals=cGroups.flatMap(group=>Object.values(group.removed_paraphrases).flat());
  const additions=cGroups.flatMap(group=>Object.values(group.added_paraphrases).flat());
  const counts=Object.fromEntries(CLASSIFICATIONS.map(classification=>[classification,groups.filter(group=>group.classification===classification).length]));
  const manifest={
    schema_version:1,audit:'vocabulary-near-synonym-prompt-differentiation',repository:'miyatayuuma/english-pwa',
    branch:'audit/vocabulary-near-synonym-prompt-differentiation',base_main_sha:BASE_MAIN,
    source_snapshots:sourceSnapshots,source_population:extraction.population,
    discovery:{...extraction,candidate_group_count:groups.length,affected_entry_count:entriesAffected.length,classification_counts:counts,paraphrase_removal_count:removals.length,paraphrase_addition_count:additions.length},
    scope:{production_changes:0,source_authorities_reaudited:0,main_merge:false},
    output_files:['manifest.json','groups.json','discovery.json','remediation-candidates.json','upstream-review.json','decisions.json','summary.md','scripts/vocabulary/build-near-synonym-prompt-differentiation-audit.mjs','scripts/vocabulary/validate-near-synonym-prompt-differentiation.mjs'],
  };
  const discovery={
    schema_version:1,base_main_sha:BASE_MAIN,population:extraction.population,
    cross_entry_canonical_overlap_pairs:extracted.directEdges,
    shared_paraphrase_overlap_pairs:extracted.allSharedPairs,
  };
  const remediation=groups.filter(group=>group.classification==='PROMPT_QUALIFIER'||group.classification==='PROMPT_AND_PARAPHRASE').map(group=>({
    group_id:group.group_id,classification:group.classification,entries:group.entries.map(entry=>entry.id),
    affected_entry_ids:[...new Set([...Object.keys(group.recommended_prompt),...Object.keys(group.recommended_paraphrases)])],
    current_prompts:Object.fromEntries(group.entries.map(entry=>[entry.id,entry.meaning_ja])),recommended_prompt:group.recommended_prompt,
    recommended_paraphrases:group.recommended_paraphrases,removed_paraphrases:group.removed_paraphrases,added_paraphrases:group.added_paraphrases,
    reason:group.reason,confidence:group.confidence,
  }));
  const upstream=groups.filter(group=>group.classification==='UPSTREAM_AUTHORITY_REVIEW').map(group=>({
    group_id:group.group_id,entries:group.entries.map(entry=>entry.id),canonical:group.entries.map(entry=>entry.canonical),
    current_prompts:group.prompt_variants,sense_keys:[...new Set(group.entries.map(entry=>entry.sense_key))],
    issue:group.reason,evidence_notes:group.evidence_notes,confidence:group.confidence,
  }));
  const summary=[
    '# Vocabulary Near-Synonym Prompt Differentiation Audit', '',
    `Base main: \`${BASE_MAIN}\``,
    `Population: ${extraction.population} Vocabulary entries.`,
    `Exact duplicate prompt groups: ${extraction.exact_prompt_collision_groups}.`,
    `Near-equivalent prompt pairs surfaced through same-sense or accepted-paraphrase overlap: ${extraction.near_prompt_pair_count}.`,
    `Candidate groups reviewed: ${groups.length}; affected entries: ${entriesAffected.length}.`,
    `KEEP: ${counts.KEEP}; PROMPT_QUALIFIER: ${counts.PROMPT_QUALIFIER}; PROMPT_AND_PARAPHRASE: ${counts.PROMPT_AND_PARAPHRASE}; UPSTREAM_AUTHORITY_REVIEW: ${counts.UPSTREAM_AUTHORITY_REVIEW}.`,
    `Recommended paraphrase removals: ${removals.length}; additions: ${additions.length}.`,
    `Cross-entry canonical/accepted-paraphrase pairs scanned: ${extraction.direct_canonical_overlap_pairs}; shared-paraphrase pairs scanned: ${extraction.shared_paraphrase_pairs}.`,
    '', '## Authority and scope', '',
    `The remote main at audit start was \`${BASE_MAIN}\`. The source snapshot is tied to the recorded production and audit authority file hashes. Existing Meaning/Canonical, Paraphrase, Grammar Role, and Final Admission authorities are inputs; this task does not rewrite them. Production changes: 0.`,
    '', '## Representative family: terrific / marvelous', '',
    ...representativeLines(groups),
    '', '## Classifications', '',
    ...groups.map(group=>`- \`${group.group_id}\` — **${group.classification}** — ${group.entries.map(entry=>`${entry.canonical} (${entry.meaning_ja})`).join('; ')} — ${group.reason}`),
    '', '## Validation', '',
    'Run `node scripts/vocabulary/validate-near-synonym-prompt-differentiation.mjs`. It checks source snapshot drift, candidate regeneration determinism, authority references, classifications, and production non-mutation.',
  ].join('\n')+'\n';
  return {manifest,groups,discovery,remediation,upstream,summary};
}

function representativeLines(groups){
  const group=groups.find(row=>row.entries.some(entry=>entry.id==='vocab:01084')&&row.entries.some(entry=>entry.id==='vocab:01246'));
  if(!group) return ['The expected pair was not extracted.'];
  const lines=[`Candidate group: \`${group.group_id}\` (${group.classification}, ${group.confidence}).`];
  for(const entry of group.entries){
    lines.push(`- **${entry.canonical}** \`${entry.id}\`: \`${entry.meaning_ja}\` → \`${group.recommended_prompt[entry.id]||entry.meaning_ja}\`; current paraphrases: ${entry.paraphrases.join(', ')||'(none)'}.`);
    if(group.recommended_paraphrases[entry.id]) lines.push(`  - Recommended paraphrases: ${group.recommended_paraphrases[entry.id].join(', ')||'(none)'}; remove: ${(group.removed_paraphrases[entry.id]||[]).join(', ')||'(none)'}.`);
  }
  lines.push(`- Reason: ${group.reason}`);
  lines.push('- Spelling: `marvellous` is a spelling variant, not a paraphrase. Runtime answer normalization does not convert British/American spelling; it remains a separate spelling-authority follow-up, outside this audit’s paraphrase recommendations.');
  return lines;
}

function writeOutputs(outputs){
  fs.mkdirSync(AUDIT_DIR,{recursive:true});
  for(const [name,value] of Object.entries({
    'manifest.json':outputs.manifest,'groups.json':outputs.groups,'discovery.json':outputs.discovery,
    'remediation-candidates.json':outputs.remediation,'upstream-review.json':outputs.upstream,
  })) fs.writeFileSync(path.join(AUDIT_DIR,name),JSON.stringify(value,null,2)+'\n');
  fs.writeFileSync(path.join(AUDIT_DIR,'summary.md'),outputs.summary);
}

function main(){
  const extracted=extract();
  if(process.argv.includes('--preview')){
    process.stdout.write(JSON.stringify({base_main_sha:BASE_MAIN,extraction:extracted.extraction,groups:extracted.groups.map(group=>({group_id:group.group_id,entries:group.entries.map(entry=>({id:entry.id,canonical:entry.canonical,meaning_ja:entry.meaning_ja,sense_key:entry.sense_key,grammarRole:entry.grammarRole,paraphrases:entry.paraphrases})),candidate_sources:group.candidate_sources,edge_count:group.discovery_stats.edge_count}))},null,2)+'\n');
    return;
  }
  if(process.argv.includes('--init-decisions')){
    fs.mkdirSync(AUDIT_DIR,{recursive:true});
    const decisions=Object.fromEntries(extracted.groups.map(group=>[group.group_id,{
      classification:'KEEP',semantic_relationship:'',nuance_dimensions:[],recommended_prompt:{},recommended_paraphrases:{},
      reason:'',confidence:'MEDIUM',evidence_notes:[],spelling_variant_notes:[],
    }]));
    fs.writeFileSync(path.join(AUDIT_DIR,'decisions.json'),JSON.stringify(decisions,null,2)+'\n');
    process.stdout.write(`Initialized ${extracted.groups.length} decision rows at ${path.relative(ROOT,path.join(AUDIT_DIR,'decisions.json'))}\n`);
    return;
  }
  const outputs=buildOutputs(applyDecisions(extracted));
  if(process.argv.includes('--check')){
    const current={
      'manifest.json':JSON.stringify(readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/manifest.json')),
      'groups.json':JSON.stringify(readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/groups.json')),
      'discovery.json':JSON.stringify(readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/discovery.json')),
      'remediation-candidates.json':JSON.stringify(readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/remediation-candidates.json')),
      'upstream-review.json':JSON.stringify(readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/upstream-review.json')),
      'summary.md':fs.readFileSync(path.join(AUDIT_DIR,'summary.md'),'utf8').trim(),
    };
    const generated={
      'manifest.json':JSON.stringify(outputs.manifest),'groups.json':JSON.stringify(outputs.groups),'discovery.json':JSON.stringify(outputs.discovery),
      'remediation-candidates.json':JSON.stringify(outputs.remediation),'upstream-review.json':JSON.stringify(outputs.upstream),'summary.md':outputs.summary.trim(),
    };
    const differences=Object.keys(generated).filter(name=>generated[name]!==current[name]);
    if(differences.length) throw new Error(`deterministic generation drift: ${differences.join(', ')}`);
    process.stdout.write(`PASS deterministic regeneration (${Object.keys(generated).length} artifacts)\n`);
    return;
  }
  writeOutputs(outputs);
  process.stdout.write(`Generated ${outputs.groups.length} groups from ${extracted.entries.length} entries at ${path.relative(ROOT,AUDIT_DIR)}\n`);
}

main();
