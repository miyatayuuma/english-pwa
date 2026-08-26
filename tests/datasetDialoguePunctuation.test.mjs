import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const items = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url), 'utf8'));
const byId = new Map(items.map((item) => [item.id, item]));

test('E0340 Japanese translation contains no accidental English prefix', () => {
  assert.equal(
    byId.get('E0340')?.ja,
    '会社のためにあくせく働くよりは、我が道を行くほうがいい。型にはまろうとしたって何の得にもならないよ！'
  );
});

test('known direct-speech punctuation repairs remain intact', () => {
  assert.equal(byId.get('E0102')?.en, '"Turn the faucet off!" Mom yelled in a rage.');
  assert.equal(byId.get('E0201')?.en, '"Do you mind if I stop by your house?" "No, not at all. Be my guest!"');
  assert.equal(byId.get('E0252')?.en, '"Watch out! The ceiling is giving way!"');
  assert.equal(byId.get('E0536')?.en, '"Living here all by myself is torture!" he sobbed.');
  assert.equal(byId.get('E0554')?.en, '"I feel for you, Jane. Grief doesn\'t fade away quickly." "I\'m OK. I\'ll get over it."');
});

test('Japanese direct-speech brackets are balanced across the dataset', () => {
  const broken = items.filter((item) => {
    const ja = String(item.ja || '');
    return (ja.match(/「/g) || []).length !== (ja.match(/」/g) || []).length;
  });
  assert.deepEqual(broken.map((item) => item.id), []);
});
