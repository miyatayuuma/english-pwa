import fs from 'node:fs';

const itemsPath = 'data/items.json';
const versionPath = 'scripts/version.js';
const swPath = 'sw.js';

const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
const byId = new Map(items.map((item) => [item.id, item]));

function patch(id, field, expected, next) {
  const item = byId.get(id);
  if (!item) throw new Error(`Missing item ${id}`);
  if (item[field] !== expected) {
    throw new Error(`${id}.${field} changed unexpectedly.\nExpected: ${expected}\nActual: ${item[field]}`);
  }
  item[field] = next;
}

// Remove an English sentence accidentally copied into the Japanese translation.
patch(
  'E0340',
  'ja',
  'Trying to fit into a mold gets me nowhere！会社のためにあくせく働くよりは、我が道を行くほうがいい。型にはまろうとしたって何の得にもならないよ！',
  '会社のためにあくせく働くよりは、我が道を行くほうがいい。型にはまろうとしたって何の得にもならないよ！'
);

// Clear direct-speech punctuation omissions/corruption. Only unambiguous cases are touched.
patch(
  'E0102',
  'en',
  'Turn the faucet off! Mom yelled in a rage.',
  '"Turn the faucet off!" Mom yelled in a rage.'
);
patch(
  'E0201',
  'en',
  'Do you mind if I stop by your house? "No, not at all. Be my guest!"',
  '"Do you mind if I stop by your house?" "No, not at all. Be my guest!"'
);
patch(
  'E0252',
  'en',
  'Watch out! The ceiling is giving way!',
  '"Watch out! The ceiling is giving way!"'
);
patch(
  'E0536',
  'en',
  'Living here all by myself is torture! he sobbed.',
  '"Living here all by myself is torture!" he sobbed.'
);
patch(
  'E0554',
  'en',
  'I "feel for you, Jane." "Grief doesn\'t fade away quickly." "I\'m OK. I\'ll get over it."',
  '"I feel for you, Jane. Grief doesn\'t fade away quickly." "I\'m OK. I\'ll get over it."'
);
patch(
  'E0554',
  'ja',
  '「ジェーン、気持ちは分かるよ。悲しみはすぐに消えるものじゃない。」「大丈夫。乗り越えてみせるわ。',
  '「ジェーン、気持ちは分かるよ。悲しみはすぐに消えるものじゃない。」「大丈夫。乗り越えてみせるわ。」'
);

// Remove a stray Japanese closing quote on a narration-only item.
patch(
  'E0213',
  'ja',
  'いつものように、マイクは時間通りに現れた。本当に時間に正確な人だ。」',
  'いつものように、マイクは時間通りに現れた。本当に時間に正確な人だ。'
);

// Basic balance check for Japanese direct-speech brackets after cleanup.
const unbalancedJapanese = items
  .filter((item) => {
    const ja = String(item.ja || '');
    return (ja.match(/「/g) || []).length !== (ja.match(/」/g) || []).length;
  })
  .map((item) => item.id);
if (unbalancedJapanese.length) {
  throw new Error(`Unbalanced Japanese dialogue brackets remain: ${unbalancedJapanese.join(', ')}`);
}

fs.writeFileSync(itemsPath, `${JSON.stringify(items, null, 2)}\n`);

let version = fs.readFileSync(versionPath, 'utf8');
if (!version.includes("const APP_VERSION = 'v5.26';")) {
  throw new Error('Expected v5.26 in scripts/version.js');
}
version = version.replace("const APP_VERSION = 'v5.26';", "const APP_VERSION = 'v5.27';");
fs.writeFileSync(versionPath, version);

let sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes('// sw.js: cache name follows the app version. v5.26')) {
  throw new Error('Expected v5.26 comment in sw.js');
}
sw = sw.replace('// sw.js: cache name follows the app version. v5.26', '// sw.js: cache name follows the app version. v5.27');
fs.writeFileSync(swPath, sw);

console.log('Patched dataset dialogue punctuation and E0340 translation; bumped cache to v5.27.');
