import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const AUDIT_DIR=path.join(ROOT,'data/audits/vocabulary-near-synonym-prompt-differentiation');
const CLASSIFICATIONS=new Set(['KEEP','PROMPT_QUALIFIER','PROMPT_AND_PARAPHRASE','UPSTREAM_AUTHORITY_REVIEW']);
const errors=[];
const fail=(message)=>errors.push(message);
const readJson=(relative)=>JSON.parse(fs.readFileSync(path.join(ROOT,relative),'utf8'));
const sha256=(buffer)=>crypto.createHash('sha256').update(buffer).digest('hex');
const gitBlobSha=(buffer)=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buffer.length}\0`),buffer])).digest('hex');
const norm=(value)=>String(value??'').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu,' ').trim();

const manifest=readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/manifest.json');
const groups=readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/groups.json');
const discovery=readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/discovery.json');
const remediation=readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/remediation-candidates.json');
const upstream=readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/upstream-review.json');
const decisions=readJson('data/audits/vocabulary-near-synonym-prompt-differentiation/decisions.json');
const production=readJson('data/vocabulary-v3.json');
const productionById=new Map(production.entries.map(entry=>[entry.id,entry]));

if(manifest.audit!=='vocabulary-near-synonym-prompt-differentiation') fail('manifest audit name mismatch');
if(!/^[0-9a-f]{40}$/.test(manifest.base_main_sha||'')) fail('invalid base main SHA');
if(manifest.scope?.production_changes!==0) fail('manifest reports production changes');
if(production.entries.length!==manifest.source_population) fail(`population drift: manifest=${manifest.source_population}, current=${production.entries.length}`);
if(discovery.population!==production.entries.length) fail('discovery population mismatch');

for(const [relative,snapshot] of Object.entries(manifest.source_snapshots||{})){
  const absolute=path.join(ROOT,relative);
  if(!fs.existsSync(absolute)){fail(`missing source authority: ${relative}`);continue;}
  const bytes=fs.readFileSync(absolute);
  if(sha256(bytes)!==snapshot.sha256) fail(`source snapshot drift: ${relative} sha256`);
  if(gitBlobSha(bytes)!==snapshot.git_blob_sha) fail(`source snapshot drift: ${relative} git blob`);
}
if(!manifest.source_snapshots?.['data/vocabulary-v3.json']) fail('production Vocabulary snapshot is not recorded');

const groupIds=new Set();
const entryIds=new Set();
const counts={KEEP:0,PROMPT_QUALIFIER:0,PROMPT_AND_PARAPHRASE:0,UPSTREAM_AUTHORITY_REVIEW:0};
let affectedEntryIds=new Set();
let removalCount=0,additionCount=0;
for(const group of groups){
  if(groupIds.has(group.group_id)) fail(`duplicate group id ${group.group_id}`);
  groupIds.add(group.group_id);
  if(!CLASSIFICATIONS.has(group.classification)) fail(`${group.group_id}: invalid classification`);
  else counts[group.classification]++;
  if(!Object.hasOwn(decisions,group.group_id)) fail(`${group.group_id}: decision missing`);
  const currentInGroup=new Map();
  for(const entry of group.entries||[]){
    if(entryIds.has(entry.id)) fail(`entry occurs in more than one candidate group: ${entry.id}`);
    entryIds.add(entry.id);
    const current=productionById.get(entry.id);
    if(!current){fail(`${group.group_id}: unknown current entry ${entry.id}`);continue;}
    currentInGroup.set(entry.id,current);
    for(const key of ['canonical','kind','subtype','grammarRole','pos','meaning_ja','sense_key']){
      if((entry[key]??null)!==(current[key]??null)) fail(`${group.group_id}/${entry.id}: current snapshot mismatch in ${key}`);
    }
    if(JSON.stringify(entry.paraphrases||[])!==JSON.stringify(current.paraphrases||[])) fail(`${group.group_id}/${entry.id}: current paraphrase snapshot mismatch`);
  }
  const promptIds=Object.keys(group.recommended_prompt||{});
  const paraIds=Object.keys(group.recommended_paraphrases||{});
  for(const id of [...promptIds,...paraIds]) if(!currentInGroup.has(id)) fail(`${group.group_id}: remediation references non-member ${id}`);
  for(const [id,prompt] of Object.entries(group.recommended_prompt||{})){
    if(typeof prompt!=='string'||!prompt.trim()) fail(`${group.group_id}/${id}: empty recommended prompt`);
    if(norm(prompt)===norm(currentInGroup.get(id)?.meaning_ja)) fail(`${group.group_id}/${id}: prompt recommendation does not change the prompt`);
    affectedEntryIds.add(id);
  }
  for(const [id,values] of Object.entries(group.recommended_paraphrases||{})){
    if(!Array.isArray(values)) fail(`${group.group_id}/${id}: recommended paraphrases are not an array`);
    affectedEntryIds.add(id);
    const before=currentInGroup.get(id)?.paraphrases||[];
    const normalized=new Set((values||[]).map(norm));
    if(normalized.size!==(values||[]).length) fail(`${group.group_id}/${id}: duplicate recommended paraphrases`);
    const removed=before.filter(value=>!normalized.has(norm(value)));
    const added=(values||[]).filter(value=>!before.some(current=>norm(current)===norm(value)));
    if(JSON.stringify(removed)!==JSON.stringify(group.removed_paraphrases?.[id]||[])) fail(`${group.group_id}/${id}: removed paraphrase diff mismatch`);
    if(JSON.stringify(added)!==JSON.stringify(group.added_paraphrases?.[id]||[])) fail(`${group.group_id}/${id}: added paraphrase diff mismatch`);
    removalCount+=removed.length; additionCount+=added.length;
  }
  if(group.classification==='KEEP'&&(promptIds.length||paraIds.length)) fail(`${group.group_id}: KEEP contains production recommendations`);
  if(group.classification==='PROMPT_QUALIFIER'&&(!promptIds.length||paraIds.length)) fail(`${group.group_id}: PROMPT_QUALIFIER must be prompt-only`);
  if(group.classification==='PROMPT_AND_PARAPHRASE'){
    if(!promptIds.length||!paraIds.length) fail(`${group.group_id}: PROMPT_AND_PARAPHRASE lacks prompt/paraphrase recommendations`);
    const groupDiff=Object.values(group.removed_paraphrases||{}).flat().length+Object.values(group.added_paraphrases||{}).flat().length;
    if(!groupDiff) fail(`${group.group_id}: C has no explicit paraphrase diff`);
  }
  if(group.classification==='UPSTREAM_AUTHORITY_REVIEW'&&(promptIds.length||paraIds.length)) fail(`${group.group_id}: D must not assert remediation values`);
  if(!group.reason||!group.semantic_relationship||!group.evidence_notes?.length) fail(`${group.group_id}: missing audit rationale/evidence`);
  if(!['HIGH','MEDIUM','LOW'].includes(group.confidence)) fail(`${group.group_id}: invalid confidence`);
}
for(const id of Object.keys(decisions)) if(!groupIds.has(id)) fail(`decision references unknown group ${id}`);
if(groups.length!==manifest.discovery?.candidate_group_count) fail('candidate group count mismatch');
for(const [classification,count] of Object.entries(counts)) if(count!==manifest.discovery?.classification_counts?.[classification]) fail(`${classification} count mismatch`);
if(affectedEntryIds.size!==manifest.discovery?.affected_entry_count) fail('affected entry count mismatch');
if(removalCount!==manifest.discovery?.paraphrase_removal_count) fail('paraphrase removal count mismatch');
if(additionCount!==manifest.discovery?.paraphrase_addition_count) fail('paraphrase addition count mismatch');
if(remediation.length!==counts.PROMPT_QUALIFIER+counts.PROMPT_AND_PARAPHRASE) fail('remediation candidate count mismatch');
if(upstream.length!==counts.UPSTREAM_AUTHORITY_REVIEW) fail('upstream review count mismatch');
if(manifest.discovery?.production_changes!==undefined&&manifest.discovery.production_changes!==0) fail('discovery reports production change');

const directPairs=new Set();
for(const edge of discovery.cross_entry_canonical_overlap_pairs||[]){
  const key=[...edge.pair_ids].sort().join('|');
  if(directPairs.has(key)) fail(`duplicate direct canonical overlap pair ${key}`);
  directPairs.add(key);
  if(edge.pair_ids.length!==2||edge.pair_ids.some(id=>!productionById.has(id))) fail(`invalid direct overlap reference ${key}`);
  if(edge.group_id&&!groupIds.has(edge.group_id)) fail(`direct overlap references unknown group ${edge.group_id}`);
}
if(directPairs.size!==manifest.discovery?.direct_canonical_overlap_pairs) fail('direct canonical overlap population mismatch');
const sharedPairs=new Set();
for(const edge of discovery.shared_paraphrase_overlap_pairs||[]){
  const key=[...edge.pair_ids].sort().join('|');
  if(sharedPairs.has(key)) fail(`duplicate shared-paraphrase pair ${key}`);
  sharedPairs.add(key);
  if(edge.pair_ids.some(id=>!productionById.has(id))) fail(`invalid shared paraphrase reference ${key}`);
  if(edge.shared_count!==(edge.shared_paraphrases||[]).length) fail(`shared paraphrase count mismatch ${key}`);
}
if(sharedPairs.size!==manifest.discovery?.shared_paraphrase_pairs) fail('shared paraphrase pair population mismatch');
if(production.entries.length!==manifest.discovery?.population) fail('source population count mismatch');

const builder=path.join(ROOT,'scripts/vocabulary/build-near-synonym-prompt-differentiation-audit.mjs');
const regenerated=spawnSync(process.execPath,[builder,'--check'],{cwd:ROOT,encoding:'utf8'});
if(regenerated.status!==0) fail(`deterministic regeneration failed: ${(regenerated.stderr||regenerated.stdout||'unknown error').trim()}`);
else process.stdout.write((regenerated.stdout||'').trim()+'\n');

if(errors.length){
  process.stderr.write(`FAIL ${errors.length} validation error(s):\n${errors.map(error=>`- ${error}`).join('\n')}\n`);
  process.exitCode=1;
}else{
  process.stdout.write(`PASS: ${production.entries.length} source entries, ${groups.length} reviewed groups, ${entryIds.size} unique candidate entries; ${Object.entries(counts).map(([key,value])=>`${key}=${value}`).join(', ')}; paraphrase removals=${removalCount}, additions=${additionCount}; production snapshot unchanged.\n`);
}
