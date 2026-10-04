import fs from 'node:fs';
import { applySentencePatternAnalysis, sentencePatternReportPatch } from './sentencePatternApplication.mjs';
import { TAGGING_SCHEMA_VERSION, validateTaggingV3Item } from './tagTaxonomy.mjs';

const ITEMS_PATH=new URL('../../data/items.json',import.meta.url);
const ANALYSIS_PATH=new URL('../../data/sentence-pattern-analysis.json',import.meta.url);
const REPORT_PATH=new URL('../../data/tagging-report.json',import.meta.url);

const items=JSON.parse(fs.readFileSync(ITEMS_PATH,'utf8'));
const analysis=JSON.parse(fs.readFileSync(ANALYSIS_PATH,'utf8'));
const report=JSON.parse(fs.readFileSync(REPORT_PATH,'utf8'));

if(!Array.isArray(items)||items.length!==560) throw new Error(`expected 560 items, got ${Array.isArray(items)?items.length:'non-list'}`);
if(items.some(item=>item.tagging_version!==TAGGING_SCHEMA_VERSION)) throw new Error('tagging schema v3 required before sentence-pattern application');
if(analysis?.schema_version!==1||analysis?.policy_version!==1) throw new Error('unsupported sentence-pattern analysis schema');

const nextItems=applySentencePatternAnalysis(items,analysis);
for(const item of nextItems){
  const errors=validateTaggingV3Item(item);
  if(errors.length) throw new Error(`${item.id}: ${errors.join('; ')}`);
}
const patch=sentencePatternReportPatch(nextItems,analysis);
const nextReport={...report,...patch};

fs.writeFileSync(ITEMS_PATH,JSON.stringify(nextItems,null,2)+'\n');
fs.writeFileSync(REPORT_PATH,JSON.stringify(nextReport,null,2)+'\n');
console.log(JSON.stringify(patch,null,2));
