#!/usr/bin/env node
// Reconstruct the 25 batched records from pinned production plus individually
// authored decisions. This never invents KEEP decisions for PENDING entries.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../data/audits/vocabulary-single-entry-nuance-qualifier");
const repo=path.resolve(root,"../../..");
const read=(p)=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const source=JSON.parse(fs.readFileSync(path.join(repo,"data/vocabulary-v3.json"),"utf8")).entries;
const index=read("review-index.json"),judgments=new Map(read("authored-judgments.json").map(x=>[x.id,x]));
const prev=new Map(read("previous-near-synonym-authority.json").entries.map(x=>[x.id,x]));
const groups=new Map(read("previous-group-membership.json").entries.map(x=>[x.id,x.groups]));
const conflicts=new Map(read("cross-audit-conflicts.json").map(x=>[x.id,x]));
const existing=new Map(read("existing-parentheses-review.json").entries.map(x=>[x.id,x]));
if(index.length!==2478||source.length!==2478)throw Error("population drift");
const rows=source.map((s,i)=>{
 const state=index[i],p=prev.get(s.id),n=judgments.get(s.id),c=conflicts.get(s.id),q=existing.get(s.id),g=groups.get(s.id)||[];
 if(state.id!==s.id||state.index!==i+1)throw Error("order drift "+i);
 const prompt=p?.recommended_prompt??n?.recommended_prompt??(q?.decision==="PARAPHRASE_REVALIDATION_ONLY"?q.recommended_prompt:null);
 const match=prompt?.match(/（([^（）]+)）\s*$/);
 return {
  id:s.id,source_index:i+1,canonical:s.canonical,grammarRole:s.grammarRole,kind:s.kind,
  current_meaning_ja:s.meaning_ja,sense_key:s.sense_key,current_paraphrases:s.paraphrases||[],
  previous_near_synonym_authority:g.some(x=>x.classification==="PROMPT_AND_PARAPHRASE")?"PROMPT_AND_PARAPHRASE":g.some(x=>x.classification==="KEEP")?"KEEP":"NONE",
  review_status:state.status,single_entry_decision:state.classification,
  recommended_prompt:prompt,qualifier_dimension:p?["previous_near_synonym_audit"]:n?[n.qualifier_dimension]:q?[q.qualifier_dimension]:[],
  qualifier_text:match?match[1]:null,
  recommended_paraphrases:p?.recommended_paraphrases??n?.recommended_paraphrases??q?.recommended_paraphrases??null,
  removed_paraphrases:p?.removed_paraphrases??n?.removed_paraphrases??q?.removed_paraphrases??[],
  added_paraphrases:p?.added_paraphrases??n?.added_paraphrases??[],
  reason:c?.issue??p?.reason??n?.reason??q?.reason??"未裁定。自動KEEPは禁止。",
  confidence:c?"LOW":p?.confidence??n?.confidence??q?.confidence??null,
  evidence:c?c.previous_group_ids:p?["previous audit 25058e095e759fe5de677f8d63267ab9669c4a06","group "+p.group_id]:n?.evidence??q?.evidence??[],
  previous_near_synonym_group_ids:g.map(x=>x.group_id)
 };
});
const fields=["id","source_index","canonical","grammarRole","kind","current_meaning_ja","sense_key","current_paraphrases","previous_near_synonym_authority","review_status","single_entry_decision","recommended_prompt","qualifier_dimension","qualifier_text","recommended_paraphrases","removed_paraphrases","added_paraphrases","confidence","reason","evidence","previous_near_synonym_group_ids"];
const norm=(x)=>Object.fromEntries(fields.map(f=>[f,x[f]??null]));
let checked=0;
for(let i=0;i<25;i++){
 const file=path.join(root,"batches","batch-"+String(i+1).padStart(3,"0")+".json");
 const expected=rows.slice(i*100,(i+1)*100);
 if(process.argv.includes("--check")){
  const actual=JSON.parse(fs.readFileSync(file,"utf8"));
  if(actual.length!==expected.length)throw Error("batch size drift "+i);
  for(let j=0;j<actual.length;j++){
   if(JSON.stringify(norm(actual[j]))!==JSON.stringify(norm(expected[j])))throw Error("deterministic source-to-decision drift "+actual[j].id);
  }
 }else{
  fs.writeFileSync(file,JSON.stringify(expected,null,2)+"\n");
 }
 checked+=expected.length;
}
if(checked!==2478)throw Error("incomplete regeneration");
console.log("PASS deterministic "+(process.argv.includes("--check")?"comparison":"generation")+": "+checked+" entries in 25 batches (pending stays pending)");
