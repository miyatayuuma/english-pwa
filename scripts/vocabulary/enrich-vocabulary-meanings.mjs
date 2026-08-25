import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, 'data/vocabulary-v2.json');
const REPORT_PATH = path.join(ROOT, 'data/vocabulary-v2-report.json');
const KAIKKI_PATH = process.env.KAIKKI_PATH || path.join(ROOT, '.tmp', 'kaikki-en-ja.jsonl');

function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function lower(s) { return norm(s).toLowerCase(); }
function jaChars(text) { return Array.from(String(text || '').replace(/[^一-龯ぁ-んァ-ヶー]/g, '')); }
function grams(chars, n) {
  const out = new Set();
  for (let i = 0; i <= chars.length - n; i += 1) out.add(chars.slice(i, i + n).join(''));
  return out;
}
function overlapScore(a, b) {
  const aa = jaChars(a), bb = jaChars(b);
  if (!aa.length || !bb.length) return 0;
  let score = 0;
  for (const n of [3, 2]) {
    const x = grams(aa, n), y = grams(bb, n);
    for (const g of x) if (y.has(g)) score += n === 3 ? 5 : 2;
  }
  return score;
}

function meaningVariants(text) {
  const cleaned = norm(text)
    .replace(/^\([^)]*\)\s*/, '')
    .replace(/^〈[^〉]*〉\s*/, '')
    .replace(/^《[^》]*》\s*/, '')
    .replace(/^[・:：\-]+/, '')
    .trim();
  if (!cleaned) return [];
  const pieces = cleaned
    .split(/\s*[;；]\s*|\s+\/\s+|(?<=[一-龯ぁ-んァ-ヶー])、(?=[一-龯ぁ-んァ-ヶー])/)
    .map(x => x.replace(/[。；;]+$/g, '').trim())
    .filter(x => x && x.length <= 60);
  return pieces.length ? pieces : [cleaned.slice(0, 60)];
}

function chooseOneMeaning(candidates, jaContext) {
  const unique = [...new Set(candidates.flatMap(meaningVariants))].filter(Boolean);
  if (!unique.length) return null;
  let best = unique[0];
  let bestScore = -1;
  for (const candidate of unique) {
    const score = overlapScore(candidate, jaContext);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return { meaning: best.slice(0, 48), score: Math.max(0, bestScore) };
}

function headwordKeys(headword) {
  const raw = lower(headword);
  const set = new Set([raw]);
  const add = s => { const k = lower(s); if (k) set.add(k); };

  add(raw.replace(/[…~～]/g, '').replace(/\s+/g, ' '));
  add(raw.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/[…~～]/g, '').replace(/\s+/g, ' '));
  add(raw.replace(/\b[a-c]\b/gi, '').replace(/[…~～]/g, '').replace(/\s+/g, ' '));
  add(raw.replace(/\bone's\b/g, "one's").replace(/[…~～]/g, '').replace(/\s+/g, ' '));

  for (const part of raw.split('/')) add(part);
  return [...set].map(x => x.replace(/^[,;: ]+|[,;: ]+$/g, '')).filter(Boolean);
}

function extractGlosses(obj) {
  const out = [];
  const push = v => {
    if (typeof v === 'string' && /[一-龯ぁ-んァ-ヶー]/.test(v)) out.push(v);
  };
  if (Array.isArray(obj.glosses)) obj.glosses.forEach(push);
  if (Array.isArray(obj.senses)) {
    for (const sense of obj.senses) {
      if (Array.isArray(sense?.glosses)) sense.glosses.forEach(push);
      if (Array.isArray(sense?.raw_glosses)) sense.raw_glosses.forEach(push);
    }
  }
  return out;
}

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const entries = db.entries || [];
const keyToEntries = new Map();
for (const entry of entries) {
  if (entry.meaning_ja) continue;
  for (const key of headwordKeys(entry.headword)) {
    if (!keyToEntries.has(key)) keyToEntries.set(key, []);
    keyToEntries.get(key).push(entry);
  }
}

const glossMap = new Map();
if (fs.existsSync(KAIKKI_PATH)) {
  const text = fs.readFileSync(KAIKKI_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const word = lower(obj.word || obj.form || obj.headword || '');
    if (!word || !keyToEntries.has(word)) continue;
    const glosses = extractGlosses(obj);
    if (!glosses.length) continue;
    if (!glossMap.has(word)) glossMap.set(word, []);
    glossMap.get(word).push(...glosses);
  }
}

let wiktionaryFilled = 0;
let compactedExisting = 0;
for (const entry of entries) {
  const jaContext = entry.examples?.[0]?.ja || '';

  if (entry.meaning_ja) {
    const one = chooseOneMeaning([entry.meaning_ja], jaContext);
    if (one?.meaning && one.meaning !== entry.meaning_ja) {
      entry.meaning_ja = one.meaning;
      compactedExisting += 1;
    }
    continue;
  }

  const candidates = [];
  for (const key of headwordKeys(entry.headword)) {
    candidates.push(...(glossMap.get(key) || []));
  }
  const chosen = chooseOneMeaning(candidates, jaContext);
  if (!chosen) continue;

  entry.meaning_ja = chosen.meaning;
  entry.meaning_confidence = chosen.score >= 5 ? 'wiktionary_aligned' : 'wiktionary_primary';
  entry.dictionary_key = entry.dictionary_key || headwordKeys(entry.headword).find(k => glossMap.has(k)) || null;
  entry.source = {
    ...(entry.source || {}),
    meaning: 'EJDict-hand CC0 or Japanese Wiktionary via Kaikki.org (CC BY-SA/GFDL), selected against existing example translation',
  };
  wiktionaryFilled += 1;
}

const remaining = entries.filter(e => !e.meaning_ja).length;
const ready = entries.filter(e => e.meaning_ja && e.match_confidence !== 'low').length;

db.policy = {
  ...(db.policy || {}),
  meanings: 'Each card stores one concise Japanese meaning. EJDict-hand (public domain) is preferred; missing entries may use Japanese Wiktionary data via Kaikki.org (CC BY-SA/GFDL), selected using the existing Japanese example as context.',
  attribution: 'Japanese Wiktionary/Kaikki-derived glosses remain subject to CC BY-SA/GFDL. See THIRD_PARTY_DATA.md.',
};
db.stats = {
  ...(db.stats || {}),
  ready_for_cards: ready,
  meanings_missing: remaining,
  meanings_wiktionary: entries.filter(e => String(e.meaning_confidence || '').startsWith('wiktionary_')).length,
};

const report = fs.existsSync(REPORT_PATH) ? JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')) : {};
report.ready_for_cards = ready;
report.meanings_missing = remaining;
report.meanings_wiktionary = db.stats.meanings_wiktionary;
report.meanings_compacted = compactedExisting;
report.wiktionary_filled_this_run = wiktionaryFilled;

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n');
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ wiktionaryFilled, compactedExisting, remaining, ready }, null, 2));
