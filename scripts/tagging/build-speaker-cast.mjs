import fs from 'node:fs';
import { buildSpeakerCastPlan, validateSpeakerCastPlan } from './speakerCasting.mjs';
import { validateReviewedVoiceDataset } from './audioVoiceTaxonomy.mjs';

const ITEMS_URL=new URL('../../data/items.json',import.meta.url);
const VOICE_URL=new URL('../../data/audio-voice-tags.json',import.meta.url);
const CASTING_URL=new URL('../../data/character-casting.json',import.meta.url);
const CHARACTERS_URL=new URL('../../data/characters.json',import.meta.url);
const PLAN_URL=new URL('../../data/speaker-cast-plan.json',import.meta.url);

const items=JSON.parse(fs.readFileSync(ITEMS_URL,'utf8'));
const voice=JSON.parse(fs.readFileSync(VOICE_URL,'utf8'));
const casting=JSON.parse(fs.readFileSync(CASTING_URL,'utf8'));
const characters=JSON.parse(fs.readFileSync(CHARACTERS_URL,'utf8'));

const voiceErrors=validateReviewedVoiceDataset(voice,items);
if(voiceErrors.length) throw new Error(`Voice dataset invalid: ${voiceErrors.join('; ')}`);

const plan=buildSpeakerCastPlan(items,voice,casting,characters);
const planErrors=validateSpeakerCastPlan(plan,items,voice,casting);
if(planErrors.length) throw new Error(`Speaker cast plan invalid: ${planErrors.join('; ')}`);

if(process.argv.includes('--write-plan')){
  fs.writeFileSync(PLAN_URL,`${JSON.stringify(plan,null,2)}\n`);
}

console.log(JSON.stringify(plan.diagnostics,null,2));
