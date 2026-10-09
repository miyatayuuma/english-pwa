import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { safeSpeechTokens } from './safeSpeechNormalization.js';
import { speechEquivalenceRules } from './speechEquivalenceRules.js';

const auditDir = new URL('../../data/audits/asr-equivalence-audit/', import.meta.url);
const artifactUrl = new URL('audit.json', auditDir);
const reportUrl = new URL('README.md', auditDir);
const readJson = async url => JSON.parse(await readFile(url, 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const gitBlobSha = value => createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');

function normUnicode(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[‘’‛ʼ＇]/gu, "'")
    .replace(/[‐‑‒–—−﹘﹣－]/gu, '-');
}

function normHyphenSpace(value) {
  return normUnicode(value).replace(/-/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function normJoined(value) {
  return normUnicode(value).replace(/[\s-]+/gu, '');
}

function speechSignature(value) {
  return safeSpeechTokens(value).map(token => token.value).join(' ');
}

function pairKey(left, right) {
  const a = normUnicode(left);
  const b = normUnicode(right);
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

const rulePairs = new Set(speechEquivalenceRules.map(rule => pairKey(rule.expected, rule.recognized)));
const registeredJoinedKeys = new Set(speechEquivalenceRules.map(rule => normJoined(rule.expected)));
const ruleInventory = speechEquivalenceRules.map(rule => ({
  id: rule.id,
  expected: rule.expected,
  recognized: rule.recognized,
  kind: rule.kind,
  credit: rule.credit,
  scope: rule.scope,
  display: rule.display,
}));

function sourceTextRecords(entry, itemById) {
  const result = [];
  const add = (kind, value, itemId = null) => {
    const text = String(value ?? '').trim();
    if (text) result.push({ kind, text, itemId });
  };
  add('canonical', entry.canonical);
  for (const answer of Array.isArray(entry.answers) ? entry.answers : []) add('answer', answer);
  for (const paraphrase of Array.isArray(entry.paraphrases) ? entry.paraphrases : []) add('paraphrase', paraphrase);
  for (const occurrence of Array.isArray(entry.occurrences) ? entry.occurrences : []) {
    const sentence = itemById.get(String(occurrence?.item_id || ''))?.en;
    const start = Number(occurrence?.start);
    const end = Number(occurrence?.end);
    if (typeof sentence !== 'string' || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end <= start || end > sentence.length) {
      occurrenceSurfaceFailures.push({ entryId: String(entry.id), itemId: String(occurrence?.item_id || ''), start, end });
      continue;
    }
    add('source-occurrence', sentence.slice(start, end), String(occurrence.item_id));
  }
  return result;
}

const occurrenceSurfaceFailures = [];

function features(text) {
  const value = String(text ?? '');
  return {
    hasHyphen: /[‐‑‒–—−﹘﹣－-]/u.test(value),
    hasApostrophe: /['’‘‛ʼ＇]/u.test(value),
    hasDigits: /\p{N}/u.test(value),
    hasUnitCue: /\b(?:km|cm|mm|kg|g|lb|lbs|usd|dollars?|percent|degrees?|celsius|fahrenheit)\b/iu.test(value),
    hasWhitespace: /\s/u.test(value),
  };
}

function candidateDisposition(left, right, family) {
  if (rulePairs.has(pairKey(left, right))
    || (family === 'joined-split' && normJoined(left) === normJoined(right) && registeredJoinedKeys.has(normJoined(left)))) return 'registered-explicit-rule';
  if (family === 'hyphen-space') return 'mechanically-safe-token-boundary';
  if (family === 'apostrophe-typography') return 'mechanically-safe-apostrophe-normalization';
  if (family === 'numeric-unit-normalization') return 'mechanically-safe-existing-normalizer';
  return 'requires-semantic-or-phonetic-review';
}

function auditSurfacePairs(entryId, surfaces) {
  const result = [];
  const unique = [];
  const seen = new Set();
  for (const surface of surfaces) {
    const key = `${surface.kind}\u0000${normUnicode(surface.text)}\u0000${surface.itemId || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(surface);
  }
  for (let leftIndex = 0; leftIndex < unique.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex += 1) {
      const left = unique[leftIndex];
      const right = unique[rightIndex];
      if (normUnicode(left.text) === normUnicode(right.text)) continue;
      const leftHyphenSpace = normHyphenSpace(left.text);
      const rightHyphenSpace = normHyphenSpace(right.text);
      let family = null;
      if (leftHyphenSpace === rightHyphenSpace) family = 'hyphen-space';
      else if (normJoined(left.text) === normJoined(right.text)
        && speechSignature(left.text) !== speechSignature(right.text)) family = 'joined-split';
      else if (normUnicode(left.text).replace(/-/gu, ' ') === normUnicode(right.text).replace(/-/gu, ' ')
        && left.text !== right.text) family = 'punctuation-spacing';
      else if (speechSignature(left.text) === speechSignature(right.text)) {
        const a = features(left.text), b = features(right.text);
        if (a.hasApostrophe || b.hasApostrophe) family = 'apostrophe-typography';
        else if (a.hasDigits || b.hasDigits || a.hasUnitCue || b.hasUnitCue) family = 'numeric-unit-normalization';
      }
      if (!family) continue;
      result.push({
        entryId,
        family,
        left: { kind: left.kind, itemId: left.itemId, text: left.text },
        right: { kind: right.kind, itemId: right.itemId, text: right.text },
        disposition: candidateDisposition(left.text, right.text, family),
        evidence: family === 'joined-split'
          ? 'same ordered letters after removing only spaces and hyphens; no automatic authority implied'
          : family === 'hyphen-space'
            ? 'same ordered speech units after treating hyphens and spaces as boundaries'
            : 'equal speech-token signature under the current safe normalizer',
      });
    }
  }
  return result;
}

const englishSpellingPairs = [
  ['color','colour'],['colors','colours'],['favorite','favourite'],['favorites','favourites'],
  ['honor','honour'],['honors','honours'],['labor','labour'],['neighbor','neighbour'],
  ['neighbors','neighbours'],['center','centre'],['centers','centres'],['theater','theatre'],
  ['organize','organise'],['organizes','organises'],['organized','organised'],['organizing','organising'],
  ['realize','realise'],['realized','realised'],['gray','grey'],['defense','defence'],
  ['license','licence'],['traveling','travelling'],['traveled','travelled'],['meter','metre'],
  ['meters','metres'],['program','programme'],
];

function wordCount(value) { return safeSpeechTokens(value).length; }

const [vocabRaw, itemsRaw] = await Promise.all([
  readJson(new URL('../../data/vocabulary-v3.json', import.meta.url)),
  readJson(new URL('../../data/items.json', import.meta.url)),
]);
const entries = Array.isArray(vocabRaw?.entries) ? vocabRaw.entries : [];
const readItems = Array.isArray(itemsRaw) ? itemsRaw : (Array.isArray(itemsRaw?.items) ? itemsRaw.items : []);
const itemById = new Map(readItems.filter(item => item?.id).map(item => [String(item.id), item]));
if (entries.length !== 2478) throw new Error(`Expected 2,478 Vocabulary entries; found ${entries.length}`);
if (readItems.length !== 560) throw new Error(`Expected 560 Read items; found ${readItems.length}`);
if (new Set(entries.map(entry => String(entry?.id || ''))).size !== entries.length) throw new Error('Vocabulary entry IDs are not unique');
if (new Set(readItems.map(item => String(item?.id || ''))).size !== readItems.length) throw new Error('Read item IDs are not unique');

const entryCoverage = [];
const pairCandidates = [];
const surfaceTexts = [];
const tdToCandidates = [];
for (const entry of entries) {
  const surfaces = sourceTextRecords(entry, itemById);
  surfaceTexts.push(...surfaces.map(surface => ({ entryId: entry.id, ...surface })));
  pairCandidates.push(...auditSurfacePairs(String(entry.id), surfaces));
  const toHits = surfaces.filter(surface => {
    const tokens = safeSpeechTokens(surface.text).map(token => token.value);
    return tokens.length >= 2 && tokens.at(-1) === 'to' && /[td]$/u.test(tokens.at(-2));
  });
  for (const hit of toHits) {
    const tokens = safeSpeechTokens(hit.text).map(token => token.value);
    tdToCandidates.push({
      entryId: String(entry.id),
      sourceKind: hit.kind,
      itemId: hit.itemId,
      surface: hit.text,
      finalCluster: `${tokens.at(-2)} ${tokens.at(-1)}`,
      disposition: 'reviewed-local-authority-only; do not generalize the spelling pattern automatically',
    });
  }
  entryCoverage.push({
    entryId: String(entry.id),
    canonical: 1,
    answers: Array.isArray(entry.answers) ? entry.answers.length : 0,
    paraphrases: Array.isArray(entry.paraphrases) ? entry.paraphrases.length : 0,
    sourceOccurrences: surfaces.filter(surface => surface.kind === 'source-occurrence').length,
    distinctAuditedSurfaces: new Set(surfaces.map(surface => normUnicode(surface.text))).size,
  });
}
if (occurrenceSurfaceFailures.length) throw new Error(`Could not resolve ${occurrenceSurfaceFailures.length} Vocabulary source occurrence surfaces`);

const readSurfaceTexts = readItems.map(item => ({
  entryId: `read:${String(item.id)}`,
  kind: 'read-item',
  itemId: String(item.id),
  text: String(item.en ?? ''),
}));
const allSurfaceTexts = [...surfaceTexts, ...readSurfaceTexts];

function globalVariantPairs(records, { family, keyFor, accepts, disposition, evidence }) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFor(record.text);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, new Map());
    const variants = groups.get(key);
    if (!variants.has(record.text)) variants.set(record.text, record);
  }
  const pairs = [];
  for (const variants of groups.values()) {
    const records = [...variants.values()];
    for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
        const left = records[leftIndex], right = records[rightIndex];
        if (left.text === right.text || !accepts(left.text, right.text)) continue;
        pairs.push({
          family,
          left: { entryId: left.entryId, sourceKind: left.kind, itemId: left.itemId, text: left.text },
          right: { entryId: right.entryId, sourceKind: right.kind, itemId: right.itemId, text: right.text },
          disposition,
          evidence,
        });
      }
    }
  }
  return pairs.sort((a, b) => a.left.text.localeCompare(b.left.text) || a.right.text.localeCompare(b.right.text));
}

const crossCorpusHyphenSpaceCandidates = globalVariantPairs(allSurfaceTexts, {
  family: 'hyphen-space',
  keyFor: normHyphenSpace,
  accepts: (left, right) => left !== right && /-/u.test(left) !== /-/u.test(right),
  disposition: 'mechanically-safe-token-boundary',
  evidence: 'same ordered full-surface text after treating hyphens and spaces as boundaries',
});
const apostropheTypographyCandidates = globalVariantPairs(allSurfaceTexts, {
  family: 'apostrophe-typography',
  keyFor: value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[‘’‛ʼ＇]/gu, "'"),
  accepts: (left, right) => left !== right
    && /[‘’‛ʼ＇]/u.test(`${left}${right}`)
    && left.normalize('NFKC').toLocaleLowerCase('en-US') !== right.normalize('NFKC').toLocaleLowerCase('en-US'),
  disposition: 'mechanically-safe-apostrophe-normalization',
  evidence: 'same full-surface text after normalizing only typographic apostrophe glyphs',
});
const apostropheOmissionCandidates = globalVariantPairs(allSurfaceTexts, {
  family: 'apostrophe-presence',
  keyFor: value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[’‘‛ʼ＇']/gu, ''),
  accepts: (left, right) => left !== right
    && /[’‘‛ʼ＇']/u.test(left) !== /[’‘‛ʼ＇']/u.test(right)
    && speechSignature(left) !== speechSignature(right),
  disposition: 'requires-phonetic-or-lexical-review',
  evidence: 'candidate pair differs by apostrophe presence; omitted apostrophes are not automatically equivalent',
});
const numericUnitCandidates = globalVariantPairs(allSurfaceTexts, {
  family: 'numeric-unit-normalization',
  keyFor: speechSignature,
  accepts: (left, right) => left !== right
    && (features(left).hasDigits || features(right).hasDigits || features(left).hasUnitCue || features(right).hasUnitCue),
  disposition: 'mechanically-safe-existing-normalizer',
  evidence: 'same ordered speech tokens under the current safe numeric/unit normalizer',
});

const spellingEvidence = new Map();
for (const item of allSurfaceTexts) {
  const words = new Set(safeSpeechTokens(item.text).map(token => token.value));
  for (const [us, uk] of englishSpellingPairs) {
    if (!words.has(us) && !words.has(uk)) continue;
    const key = `${us}|${uk}`;
    if (!spellingEvidence.has(key)) spellingEvidence.set(key, { us, uk, usEvidence: 0, ukEvidence: 0 });
    const record = spellingEvidence.get(key);
    if (words.has(us)) record.usEvidence += 1;
    if (words.has(uk)) record.ukEvidence += 1;
  }
}
const spellingCandidates = [...spellingEvidence.values()]
  .filter(record => record.usEvidence && record.ukEvidence)
  .map(record => ({ ...record, disposition: 'requires pronunciation and lexical review; not registered automatically' }));

const joinedNgrams = new Map();
for (const source of allSurfaceTexts) {
  const tokens = safeSpeechTokens(source.text);
  for (let start = 0; start < tokens.length; start += 1) {
    for (let length = 1; length <= 4 && start + length <= tokens.length; length += 1) {
      const selected = tokens.slice(start, start + length);
      const words = selected.map(token => token.value);
      const joined = words.join('');
      if (joined.length < 4 || !/\p{L}/u.test(joined)) continue;
      const variant = words.join('|');
      if (!joinedNgrams.has(joined)) joinedNgrams.set(joined, new Map());
      const variants = joinedNgrams.get(joined);
      if (!variants.has(variant)) variants.set(variant, {
        words,
        example: {
          entryId: source.entryId,
          sourceKind: source.kind,
          itemId: source.itemId,
          text: source.text.slice(selected[0].start, selected.at(-1).end),
        },
      });
    }
  }
}

const globalJoinedSplitCandidates = [];
for (const [joined, variantMap] of joinedNgrams) {
  const variants = [...variantMap.values()];
  for (let leftIndex = 0; leftIndex < variants.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < variants.length; rightIndex += 1) {
      const left = variants[leftIndex];
      const right = variants[rightIndex];
      if ((left.words.length === 1) === (right.words.length === 1)) continue;
      const leftText = left.example.text;
      const rightText = right.example.text;
      globalJoinedSplitCandidates.push({
        family: 'joined-split',
        joinedKey: joined,
        left: left.example,
        right: right.example,
        disposition: candidateDisposition(leftText, rightText, 'joined-split'),
        evidence: 'same compact letter sequence in corpus n-grams; extraction is not speech authority',
      });
    }
  }
}

const readCoverage = readItems.map(item => ({
  itemId: String(item.id),
  text: String(item.en ?? ''),
  textLength: String(item.en ?? '').length,
  tokenCount: wordCount(item.en),
  hasHyphen: features(item.en).hasHyphen,
  hasApostrophe: features(item.en).hasApostrophe,
  hasDigits: features(item.en).hasDigits,
  registeredRuleIdsPresent: ruleInventory.filter(rule => ` ${speechSignature(item.en)} `.includes(` ${speechSignature(rule.expected)} `)).map(rule => rule.id),
}));

const vocabularyFeatureCounts = surfaceTexts.reduce((counts, surface) => {
  const value = features(surface.text);
  for (const [key, enabled] of Object.entries(value)) if (enabled) counts[key] += 1;
  counts.auditedSurfaceRecords += 1;
  return counts;
}, { hasHyphen: 0, hasApostrophe: 0, hasDigits: 0, hasUnitCue: 0, hasWhitespace: 0, auditedSurfaceRecords: 0 });
const readFeatureCounts = readSurfaceTexts.reduce((counts, surface) => {
  const value = features(surface.text);
  for (const [key, enabled] of Object.entries(value)) if (enabled) counts[key] += 1;
  counts.auditedSurfaceRecords += 1;
  return counts;
}, { hasHyphen: 0, hasApostrophe: 0, hasDigits: 0, hasUnitCue: 0, hasWhitespace: 0, auditedSurfaceRecords: 0 });

const artifact = {
  schema: 'english-pwa-asr-equivalence-candidate-audit-v1',
  source: {
    vocabularyBlob: gitBlobSha(await readFile(new URL('../../data/vocabulary-v3.json', import.meta.url))),
    itemsBlob: gitBlobSha(await readFile(new URL('../../data/items.json', import.meta.url))),
    vocabularyJsonSha256: sha(await readFile(new URL('../../data/vocabulary-v3.json', import.meta.url))),
    itemsJsonSha256: sha(await readFile(new URL('../../data/items.json', import.meta.url))),
  },
  population: {
    vocabularyEntries: entries.length,
    readItems: readItems.length,
    vocabularySurfaceRecords: surfaceTexts.length,
    readSurfaceRecords: readSurfaceTexts.length,
    entryCoverageComplete: entryCoverage.length === 2478 && new Set(entryCoverage.map(record => record.entryId)).size === 2478,
    readCoverageComplete: readCoverage.length === 560 && new Set(readCoverage.map(record => record.itemId)).size === 560,
    answersFieldPresentCount: entries.filter(entry => Array.isArray(entry.answers)).length,
    vocabularyFeatureCounts,
    readFeatureCounts,
  },
  methods: {
    hyphenSpace: 'classified as the same ordered speech-token boundaries; offsets remain source-mapped',
    joinedSplit: 'candidate extraction only; joining is accepted only by an explicit speech-equivalence rule',
    apostrophes: 'typographic apostrophes normalize to ASCII apostrophe; omitted apostrophes are not globally collapsed',
    numericUnits: 'existing safeSpeechTokens behavior only',
    englishSpelling: 'known US/UK candidates are enumerated only when both corpus forms occur; no production rule is created',
    phonetic: 'current registered homophone and local connected-speech rules are inventoried; newly inferred phonetic pairs remain review-only',
    tDTo: 'final t/d plus to surfaces are enumerated and kept local; no generic stem-rewrite rule is created',
  },
  candidateCounts: {
    sameEntrySurfacePairs: pairCandidates.length,
    crossCorpusJoinedSplitPairs: globalJoinedSplitCandidates.length,
    crossCorpusRegistered: globalJoinedSplitCandidates.filter(pair => pair.disposition === 'registered-explicit-rule').length,
    crossCorpusReviewOnly: globalJoinedSplitCandidates.filter(pair => pair.disposition === 'requires-semantic-or-phonetic-review').length,
    crossCorpusHyphenSpacePairs: crossCorpusHyphenSpaceCandidates.length,
    apostropheTypographyPairs: apostropheTypographyCandidates.length,
    apostrophePresenceReviewPairs: apostropheOmissionCandidates.length,
    numericUnitNormalizedPairs: numericUnitCandidates.length,
    mechanicallySafeOrRegistered: pairCandidates.filter(pair => pair.disposition.startsWith('mechanically-safe') || pair.disposition === 'registered-explicit-rule').length,
    sameEntryReviewOnly: pairCandidates.filter(pair => pair.disposition === 'requires-semantic-or-phonetic-review').length,
    requiresSemanticOrPhoneticReview: pairCandidates.filter(pair => pair.disposition === 'requires-semantic-or-phonetic-review').length
      + globalJoinedSplitCandidates.filter(pair => pair.disposition === 'requires-semantic-or-phonetic-review').length
      + spellingCandidates.length
      + apostropheOmissionCandidates.length,
    tDToSurfaceCandidates: tdToCandidates.length,
    crossLocaleSpellingPairs: spellingCandidates.length,
    speechEquivalenceRules: ruleInventory.length,
  },
  candidatePairs: pairCandidates.sort((a, b) => a.entryId.localeCompare(b.entryId) || a.family.localeCompare(b.family) || a.left.text.localeCompare(b.left.text) || a.right.text.localeCompare(b.right.text)),
  crossCorpusJoinedSplitCandidates: globalJoinedSplitCandidates.sort((a, b) => a.joinedKey.localeCompare(b.joinedKey) || a.left.text.localeCompare(b.left.text) || a.right.text.localeCompare(b.right.text)),
  crossCorpusHyphenSpaceCandidates,
  apostropheTypographyCandidates,
  apostropheOmissionCandidates,
  numericUnitCandidates,
  englishSpellingCandidates: spellingCandidates.sort((a, b) => a.us.localeCompare(b.us)),
  tDToCandidates: tdToCandidates.sort((a, b) => a.entryId.localeCompare(b.entryId) || a.surface.localeCompare(b.surface)),
  ruleInventory,
  negativeControls: [
    { left: 'insight', right: 'in sight', expected: 'no automatic equivalence', status: 'regression-tested' },
    { left: 'resign', right: 're-sign', expected: 'no automatic equivalence', status: 'regression-tested' },
    { left: 'another', right: 'an other', expected: 'no automatic equivalence', status: 'regression-tested' },
    { left: 'post war', right: 'post unrelated war', expected: 'no contiguous phrase match', status: 'regression-tested' },
    { left: 'post war', right: 'war post', expected: 'no reordered match', status: 'regression-tested' },
  ],
  vocabularyEntryCoverage: entryCoverage,
  vocabularySurfaceRecords: surfaceTexts,
  readItemCoverage: readCoverage,
};

const report = `# ASR equivalence corpus candidate audit\n\n`
  + `This artifact scans the current Vocabulary and Read source populations without editing either production dataset.\n\n`
  + `- Vocabulary blob: \`${artifact.source.vocabularyBlob}\`; items blob: \`${artifact.source.itemsBlob}\`\n`
  + `- Vocabulary: ${entries.length.toLocaleString('en-US')} entries; ${surfaceTexts.length.toLocaleString('en-US')} audited canonical/answer/paraphrase/source-surface records\n`
  + `- Read: ${readItems.length.toLocaleString('en-US')} sentences (all included in joined/split and spelling candidate scans)\n`
  + `- Same-entry surface pairs: ${pairCandidates.length.toLocaleString('en-US')}; cross-corpus joined/split pairs: ${globalJoinedSplitCandidates.length.toLocaleString('en-US')} (${artifact.candidateCounts.crossCorpusRegistered} explicitly registered, ${artifact.candidateCounts.crossCorpusReviewOnly} review-only)\n`
  + `- Mechanically safe or already explicit: ${artifact.candidateCounts.mechanicallySafeOrRegistered.toLocaleString('en-US')}\n`
  + `- Same-entry review-only pairs: ${artifact.candidateCounts.sameEntryReviewOnly.toLocaleString('en-US')}; cross-corpus joined/split and spelling pairs held for review: ${(artifact.candidateCounts.crossCorpusReviewOnly + spellingCandidates.length).toLocaleString('en-US')}\n`
  + `- Cross-corpus hyphen/space candidates: ${crossCorpusHyphenSpaceCandidates.length.toLocaleString('en-US')}; apostrophe glyph/presence pairs: ${apostropheTypographyCandidates.length.toLocaleString('en-US')} safe / ${apostropheOmissionCandidates.length.toLocaleString('en-US')} review-only; numeric/unit normalized pairs: ${numericUnitCandidates.length.toLocaleString('en-US')}\n`
  + `- Final t/d plus to surfaces: ${tdToCandidates.length.toLocaleString('en-US')}\n`
  + `- Cross-locale spelling pairs observed in both forms: ${spellingCandidates.length.toLocaleString('en-US')}\n`
  + `- Registered speech rules inventoried: ${ruleInventory.length.toLocaleString('en-US')}\n\n`
  + `Joined/split pairs, locale spelling pairs, and new phonetic candidates remain review-only unless an exact explicit rule exists. Production data and card semantic authority are not modified by this audit.\n\n`
  + `Full per-entry, per-sentence coverage and candidate details are in [audit.json](./audit.json).\n`;

if (process.argv.includes('--write')) {
  await mkdir(auditDir, { recursive: true });
  await writeFile(artifactUrl, `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(reportUrl, report);
  console.log(`WROTE ASR candidate audit: ${entries.length} Vocabulary entries, ${readItems.length} Read items, ${pairCandidates.length} surface pairs`);
} else {
  const prior = await readJson(artifactUrl);
  const priorReport = await readFile(reportUrl, 'utf8');
  if (JSON.stringify(prior) !== JSON.stringify(artifact) || priorReport !== report) {
    throw new Error('ASR candidate audit artifacts are stale; run with --write');
  }
  console.log(`PASS ASR candidate audit: ${entries.length} Vocabulary entries, ${readItems.length} Read items, ${pairCandidates.length} surface pairs`);
}
