import fs from 'node:fs';
import { buildSpeakerCastPlan, validateSpeakerCastPlan } from './speakerCasting.mjs';
import { applySpeakerCastPlan, speakerCastReportPatch } from './speakerCastApplication.mjs';
import { validateReviewedVoiceDataset } from './audioVoiceTaxonomy.mjs';
import { TAGGING_SCHEMA_VERSION, validateTaggingV3Item } from './tagTaxonomy.mjs';

const ITEMS_URL=new URL('../../data/items.json',import.meta.url);
const VOICE_URL=new URL('../../data/audio-voice-tags.json',import.meta.url);
const CASTING_URL=new URL('../../data/character-casting.json',import.meta.url);
const CHARACTERS_URL=new URL('../../data/characters.json',import.meta.url);
const REPORT_URL=new URL('../../data/tagging-report.json',import.meta.url);
const PLAN_URL=new URL('../../data/speaker-cast-plan.json',import.meta.url);

const items=JSON.parse(fs.readFileSync(ITEMS_URL,'utf8'));
const voice=JSON.parse(fs.readFileSync(VOICE_URL,'utf8'));
const casting=JSON.parse(fs.readFileSync(CASTING_URL,'utf8'));
const characters=JSON.parse(fs.readFileSync(CHARACTERS_URL,'utf8'));
const report=JSON.parse(fs.readFileSync(REPORT_URL,'utf8'));

if(!Array.isArray(items)||items.length!==560) throw new Error(`Expected 560 items, got ${Array.isArray(items)?items.length:'non-array'}`);
if(items.some(item=>item?.tagging_version!==TAGGING_SCHEMA_VERSION)){
  throw new Error(`Speaker casting requires tagging schema v${TAGGING_SCHEMA_VERSION}; run enrich-items.mjs first`);
}

const voiceErrors=validateReviewedVoiceDataset(voice,items);
if(voiceErrors.length) throw new Error(`Voice dataset invalid: ${voiceErrors.join('; ')}`);

const plan=buildSpeakerCastPlan(items,voice,casting,characters);
const planErrors=validateSpeakerCastPlan(plan,items,voice,casting);
if(planErrors.length) throw new Error(`Speaker cast plan invalid: ${planErrors.join('; ')}`);

const castItems=applySpeakerCastPlan(items,plan);
for(const item of castItems){
  const errors=validateTaggingV3Item(item);
  if(errors.length) throw new Error(`Tagging invariant failed for ${item.id}: ${errors.join('; ')}`);
  if(!item.speaker_tags.length) throw new Error(`${item.id}: missing speaker assignment`);
}

const nextReport={
  ...report,
  tagging_version:TAGGING_SCHEMA_VERSION,
  ...speakerCastReportPatch(castItems,plan.diagnostics),
};

fs.writeFileSync(ITEMS_URL,`${JSON.stringify(castItems,null,2)}\n`);
fs.writeFileSync(REPORT_URL,`${JSON.stringify(nextReport,null,2)}\n`);
fs.writeFileSync(PLAN_URL,`${JSON.stringify(plan,null,2)}\n`);
console.log(JSON.stringify(plan.diagnostics,null,2));
