import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPreferredVoice, scoreVoicePreference } from '../scripts/speech/synthesis.js';

test('American English outranks default British English when both are available',()=>{
  const us={name:'US English',lang:'en-US',default:false,localService:false};
  const gb={name:'English UK',lang:'en-GB',default:true,localService:true};
  assert.ok(scoreVoicePreference(us)>scoreVoicePreference(gb));
  assert.equal(pickPreferredVoice([gb,us]),us);
});

test('underscore locale notation is treated as American English',()=>{
  const us={name:'English Voice',lang:'en_US'};
  const au={name:'English Voice',lang:'en-AU',default:true};
  assert.equal(pickPreferredVoice([au,us]),us);
});

test('another English locale is used only when American English is unavailable',()=>{
  const gb={name:'English UK',lang:'en-GB'};
  const ja={name:'Japanese',lang:'ja-JP',default:true};
  assert.equal(pickPreferredVoice([ja,gb]),gb);
});
