import test from 'node:test';
import assert from 'node:assert/strict';
import { compactComposeChunks } from '../scripts/app/composeGuide.js';

function singles(words){
  return words.map(word=>({display:word,tokens:[word.toLowerCase()]}));
}

test('word-order support compacts long sentences into a small number of phrase blocks',()=>{
  const chunks=compactComposeChunks(singles('I can assure you that everything will turn out just fine today'.split(' ')));
  assert.ok(chunks.length>=3&&chunks.length<=5);
  assert.equal(chunks.flatMap(chunk=>chunk.tokens).length,12);
  assert.ok(chunks.every(chunk=>chunk.tokens.length>=2));
});

test('existing multiword chunks are preserved when the bank is already compact',()=>{
  const source=[
    {display:'take it easy',tokens:['take','it','easy']},
    {display:'everything will',tokens:['everything','will']},
    {display:'turn out fine',tokens:['turn','out','fine']},
  ];
  assert.deepEqual(compactComposeChunks(source),source);
});
