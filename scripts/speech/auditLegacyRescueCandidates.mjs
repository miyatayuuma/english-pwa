#!/usr/bin/env node

// Offline audit only. This reproduces the legacy candidate generators so the
// historical candidate surface can be reviewed without making them runtime
// grading authorities.
import fs from 'node:fs/promises';
import { toks } from '../utils/text.js';

const root = new URL('../../', import.meta.url);
const readJson = async path => JSON.parse(await fs.readFile(new URL(path, root), 'utf8'));
const itemsRaw = await readJson('data/items.json');
const vocabularyRaw = await readJson('data/vocabulary-v3.json');
const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw.items || []);
const entries = Array.isArray(vocabularyRaw) ? vocabularyRaw : (vocabularyRaw.entries || []);
const itemsById = new Map(items.map(item => [String(item.id), item]));

const sourceSurfaces = [];
for (const item of items) if (typeof item.en === 'string') sourceSurfaces.push(item.en);
for (const entry of entries) {
  if (typeof entry.canonical === 'string') sourceSurfaces.push(entry.canonical);
  for (const answer of entry.answers || []) if (typeof answer === 'string') sourceSurfaces.push(answer);
  for (const occurrence of entry.occurrences || []) {
    const item = itemsById.get(String(occurrence.item_id));
    const start = Number(occurrence.start);
    const end = Number(occurrence.end);
    if (item?.en && Number.isInteger(start) && Number.isInteger(end)
      && start >= 0 && end > start && end <= item.en.length) {
      sourceSurfaces.push(item.en.slice(start, end));
    }
  }
}

const words = new Set(sourceSurfaces.flatMap(surface => toks(surface)));
const canonicalPair = (left, right) => left < right ? [left, right] : [right, left];
const pairKey = (left, right) => canonicalPair(left, right).join('\t');

function editDistanceOne(left, right) {
  if (!left || !right || left === right || Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let differences = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    differences += 1;
    if (differences > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else { i += 1; j += 1; }
  }
  return differences + (left.length - i) + (right.length - j) === 1;
}

function deletionSignatures(word) {
  const signatures = new Set([word]);
  for (let index = 0; index < word.length; index += 1) {
    signatures.add(word.slice(0, index) + word.slice(index + 1));
  }
  return signatures;
}

function soundex(word) {
  const map = new Map([
    ['B', '1'], ['F', '1'], ['P', '1'], ['V', '1'],
    ['C', '2'], ['G', '2'], ['J', '2'], ['K', '2'], ['Q', '2'], ['S', '2'], ['X', '2'], ['Z', '2'],
    ['D', '3'], ['T', '3'], ['L', '4'], ['M', '5'], ['N', '5'], ['R', '6'],
  ]);
  const cleaned = word.toUpperCase().normalize('NFKD').replace(/[^A-Z]/g, '');
  if (!cleaned) return '';
  let key = cleaned[0];
  let previous = map.get(cleaned[0]) || '';
  for (const letter of cleaned.slice(1)) {
    const code = map.get(letter) || '';
    if (!code) { previous = ''; continue; }
    if (code !== previous) key += code;
    previous = code;
    if (key.length >= 4) break;
  }
  return key.padEnd(4, '0').slice(0, 4);
}

const signatureIndex = new Map();
for (const word of words) {
  for (const signature of deletionSignatures(word)) {
    if (!signatureIndex.has(signature)) signatureIndex.set(signature, []);
    signatureIndex.get(signature).push(word);
  }
}
const editPairs = new Set();
for (const group of signatureIndex.values()) {
  for (let left = 0; left < group.length; left += 1) {
    for (let right = left + 1; right < group.length; right += 1) {
      const [a, b] = canonicalPair(group[left], group[right]);
      if (editDistanceOne(a, b)) editPairs.add(pairKey(a, b));
    }
  }
}

const soundexGroups = new Map();
for (const word of words) {
  const key = soundex(word);
  if (!soundexGroups.has(key)) soundexGroups.set(key, []);
  soundexGroups.get(key).push(word);
}
const soundexPairs = new Set();
for (const group of soundexGroups.values()) {
  for (let left = 0; left < group.length; left += 1) {
    for (let right = left + 1; right < group.length; right += 1) {
      soundexPairs.add(pairKey(group[left], group[right]));
    }
  }
}

const splitFusedPairs = new Set();
for (const surface of sourceSurfaces) {
  const tokens = toks(surface);
  for (let start = 0; start < tokens.length; start += 1) {
    let fused = '';
    for (let end = start; end < tokens.length; end += 1) {
      fused += tokens[end];
      if (end > start && words.has(fused)) {
        splitFusedPairs.add(pairKey(fused, tokens.slice(start, end + 1).join(' ')));
      }
    }
  }
}

const acceptedHomophonePairs = new Set([
  pairKey('buy', 'by'),
  pairKey('cell', 'sell'),
  pairKey('fair', 'fare'),
  pairKey('hear', 'here'),
  pairKey('one', 'won'),
  pairKey('peace', 'piece'),
  pairKey('plain', 'plane'),
  pairKey('principal', 'principle'),
  pairKey('suite', 'sweet'),
  pairKey('their', 'there'),
  pairKey('weather', 'whether'),
]);

function classify(pair) {
  return acceptedHomophonePairs.has(pair)
    ? 'KEEP_AS_EXPLICIT_EQUIVALENCE'
    : 'REJECT_AS_FALSE_POSITIVE_RISK';
}

function inventoryFor(pairs) {
  const candidates = [...pairs].sort();
  return {
    classificationDefault: 'REJECT_AS_FALSE_POSITIVE_RISK',
    candidates: candidates.map(value => value.replace('\t', ' / ')),
    keepAsExplicitEquivalence: candidates
      .filter(value => classify(value) === 'KEEP_AS_EXPLICIT_EQUIVALENCE')
      .map(value => value.replace('\t', ' / ')),
  };
}

const manualReviews = [
  { expected: 'prose', recognized: 'pros', kind: 'homophone', classification: 'KEEP_AS_EXPLICIT_EQUIVALENCE', evidence: 'Required by task; CMUdict lists the same pronunciation.' },
  { expected: 'postwar', recognized: 'post war', kind: 'segmentation-equivalence', classification: 'KEEP_AS_EXPLICIT_EQUIVALENCE', evidence: 'Required by task; one lexical unit versus the same two spoken units.' },
  { expected: 'rain forest', recognized: 'rainforest', kind: 'segmentation-equivalence', classification: 'KEEP_AS_EXPLICIT_EQUIVALENCE', evidence: 'Historical matcher test; same compound with a fused spelling.' },
  { expected: 'suite', recognized: 'sweet', kind: 'homophone', classification: 'KEEP_AS_EXPLICIT_EQUIVALENCE', evidence: 'Historical matcher test; CMUdict lists the same pronunciation.' },
  { expected: 'hear', recognized: 'here', kind: 'homophone', classification: 'KEEP_AS_EXPLICIT_EQUIVALENCE', evidence: 'Historical matcher test; CMUdict lists the same pronunciation.' },
  { expected: 'too', recognized: 'to', kind: 'homophone-candidate', classification: 'REJECT_AS_FALSE_POSITIVE_RISK', evidence: 'Cambridge lists reduced /tə/ and strong /tuː/ for “to”, while “too” is /tuː/ in UK and US English (https://dictionary.cambridge.org/pronunciation/english/to; https://dictionary.cambridge.org/pronunciation/english/too). Transcript text has no prosodic evidence to distinguish them, and no provider-specific confusion evidence supports a directional rule.' },
  { expected: 'one', recognized: 'won', kind: 'homophone', classification: 'NOT_USED / IRRELEVANT', evidence: 'Not emitted by the legacy matcher candidate generator: safe token canonicalization maps “one” to “1” before fuzzy comparison.' },
  { expected: 'apart', recognized: 'a part', kind: 'segmentation-equivalence', classification: 'REJECT_AS_FALSE_POSITIVE_RISK', evidence: 'Distinct words and meaning; automatic fusion is unsafe.' },
  ...[...splitFusedPairs].sort().map(value => {
    const [left, right] = value.split('\t');
    return { expected: right, recognized: left, kind: 'segmentation-candidate', classification: 'REJECT_AS_FALSE_POSITIVE_RISK', evidence: 'Corpus pair is only a concatenation coincidence; no approved equivalence.' };
  }),
];

const sourceSha = '21daec183d8935d441e277f72ecaff79efe09197';
const inventory = {
  title: 'Legacy speech rescue candidate audit',
  sourceSha,
  corpora: {
    readClozeItems: items.length,
    vocabularyEntries: entries.length,
    surfacesScanned: sourceSurfaces.length,
    distinctNormalizedTokens: words.size,
  },
  classificationPolicy: {
    editDistanceOne: 'REJECT_AS_FALSE_POSITIVE_RISK unless an individually reviewed acoustic equivalence is listed as KEEP.',
    soundex: 'REJECT_AS_FALSE_POSITIVE_RISK unless an individually reviewed acoustic equivalence is listed as KEEP.',
    splitFused: 'List every observed corpus n-gram/token concatenation candidate and classify individually; task-specified pairs are reviewed separately.',
  },
  editDistanceOne: inventoryFor(editPairs),
  soundex: inventoryFor(soundexPairs),
  splitFused: [...splitFusedPairs].sort().map(value => {
    const [left, right] = value.split('\t');
    return { left, right, classification: 'REJECT_AS_FALSE_POSITIVE_RISK' };
  }),
  manualReviews,
};

const outputPath = new URL('../../docs/speech-legacy-rescue-audit.json', import.meta.url);
await fs.writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath: outputPath.pathname,
  sourceSha,
  corpora: inventory.corpora,
  editDistanceOneCandidates: inventory.editDistanceOne.candidates.length,
  soundexCandidates: inventory.soundex.candidates.length,
  splitFusedCandidates: inventory.splitFused.length,
  classifications: {
    editDistanceOneKeep: inventory.editDistanceOne.keepAsExplicitEquivalence.length,
    soundexKeep: inventory.soundex.keepAsExplicitEquivalence.length,
  },
}, null, 2));
