import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ITEMS_PATH = path.join(ROOT, 'data/items.json');

const items = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));

// Only fixes with very high confidence: obvious OCR/input errors or malformed spacing/quotes.
const explicitFixes = new Map([
  ['E0011', {
    en: s => s.replace(/\bnobel\b/g, 'novel'),
  }],
  ['E0019', {
    ja: s => s.replace(/紫敵/g, '素敵'),
  }],
  ['E0038', {
    ja: s => s.replace(/さらさせてきた/g, 'さらされてきた'),
  }],
  ['E0062', {
    ja: s => s.replace(/骨蓮品/g, '骨董品'),
  }],
  ['E0063', {
    en: s => s.replace(/^"Anything else\?\s+"That's it\."/, '"Anything else?" "That\'s it."'),
  }],
  ['E0102', {
    en: s => s.replace(/faucet off! mom yelled/g, 'faucet off! Mom yelled'),
  }],
  ['E0172', {
    en: s => s.replace(/"What is 'an instrument\?"/, '"What is \'an instrument\'?"'),
  }],
  ['E0177', {
    ja: s => s.replace(/完壁/g, '完璧'),
  }],
  ['E0178', {
    ja: s => s.replace(/3ケ月/g, '3ヶ月'),
  }],
  ['E0340', {
    en: s => s.replace(/\bTrting\b/g, 'Trying'),
    ja: s => s.replace(/^Trying to fit into a mold gets me nowhere!\s*/, ''),
  }],
  ['E0366', {
    en: s => s.replace(/Couldn't be better! i did/g, "Couldn't be better! I did"),
  }],
  ['E0526', {
    en: s => s.replace(/\banytmore\b/g, 'anymore'),
  }],
  ['E0559', {
    en: s => s.replace(/Let's see \.\./g, "Let's see..."),
  }],
]);

const jp = '[一-龯々〆ヵヶぁ-んァ-ヶー]';

function cleanEnglish(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,;:!?])/g, '$1')
    .replace(/([!?])(?=[A-Z])/g, '$1 ')
    .replace(/([a-z]{2})\.(?=[A-Z])/g, '$1. ')
    .trim();
}

function cleanJapanese(s) {
  // Do not NFKC-normalize the whole Japanese string: that needlessly turns
  // Japanese full-width punctuation into ASCII. Normalize only known noise.
  let out = String(s || '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/｡/g, '。')
    .replace(/､/g, '、')
    .replace(/｢/g, '「')
    .replace(/｣/g, '」')
    .replace(/\?/g, '？')
    .replace(/!/g, '！')
    .replace(/\(/g, '（')
    .replace(/\)/g, '）')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([。、！？）」』】])/g, '$1')
    .replace(/([「『（【])\s+/g, '$1')
    .trim();

  const betweenJapanese = new RegExp(`(${jp}) +(?=${jp})`, 'g');
  const beforeJapanesePunctuation = new RegExp(`(${jp}) +(?=[。、！？）』」】])`, 'g');
  const afterJapanesePunctuation = new RegExp(`([、。！？]) +(?=${jp})`, 'g');
  out = out
    .replace(betweenJapanese, '$1')
    .replace(beforeJapanesePunctuation, '$1')
    .replace(afterJapanesePunctuation, '$1');
  return out;
}

const changes = [];
for (const item of items) {
  const beforeEn = item.en;
  const beforeJa = item.ja;

  item.en = cleanEnglish(item.en);
  item.ja = cleanJapanese(item.ja);

  const fix = explicitFixes.get(item.id);
  if (fix?.en) item.en = cleanEnglish(fix.en(item.en));
  if (fix?.ja) item.ja = cleanJapanese(fix.ja(item.ja));

  if (item.en !== beforeEn || item.ja !== beforeJa) {
    changes.push({ id: item.id, before_en: beforeEn, after_en: item.en, before_ja: beforeJa, after_ja: item.ja });
  }
}

fs.writeFileSync(ITEMS_PATH, JSON.stringify(items, null, 2) + '\n');
console.log(JSON.stringify({ changed_items: changes.length, changes }, null, 2));
