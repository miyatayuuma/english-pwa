import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditReorderChunkQuality } from '../scripts/reorder/validate-reorder-metadata.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const metadata = read('data/reorder-v1.json');
const report = read('data/reorder-report.json');
const baseline = read('data/reorder-chunk-quality-baseline.json');
const items = read('data/items.json');
const sourceById = new Map(items.map((item) => [String(item.id), item]));
const generatedById = new Map(metadata.items.map((item) => [String(item.itemId), item]));
const clauseRelations = new Set(['advcl', 'acl', 'acl:relcl', 'relcl', 'ccomp', 'xcomp', 'csubj', 'csubjpass']);

function sentence(itemId, sentenceIndex = 0) {
  const value = generatedById.get(itemId)?.sentences?.[sentenceIndex];
  assert.ok(value, `missing generated sentence ${itemId}/${sentenceIndex}`);
  return value;
}

function tileAt(value, tier, tokenIndex) {
  return value.variants?.[tier]?.tiles?.find((tile) => tile.tokenStart <= tokenIndex && tokenIndex < tile.tokenEnd);
}

function dependencySpan(value, headIndex) {
  const selected = new Set([headIndex]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const token of value.tokens) {
      if (!selected.has(token.i) && selected.has(token.head)) {
        selected.add(token.i);
        changed = true;
      }
    }
  }
  return [Math.min(...selected), Math.max(...selected) + 1];
}

function tilesIntersecting(value, tier, [start, end]) {
  return value.variants?.[tier]?.tiles?.filter((tile) => tile.tokenStart < end && tile.tokenEnd > start) ?? [];
}

function assertSplit(value, tier, span, minimumTiles = 2) {
  const selected = tilesIntersecting(value, tier, span);
  assert.ok(selected.length >= minimumTiles, `${tier} leaves a nested constituent in one tile: ${selected.map((tile) => tile.text).join(' / ')}`);
  return selected;
}

const chunkQualityCases = [
  ['E0110', 0], ['E0050', 0], ['E0462', 0], ['E0018', 0],
  ['E0033', 0], ['E0141', 0], ['E0161', 0],
];

test('the pre-change audit cohort is retained as a 67-sentence regression fixture', () => {
  assert.equal(baseline.baselineMainSha, 'b370462dc7a9a1c3d5193752dd2752b91d3a74f7');
  assert.equal(baseline.baselineMetadataSha256, '61c4bdbe8eca6a0211f579b78710c13269d5d0a50a64d4138b13faa7dd26e73a');
  assert.equal(baseline.priorAuditCounts.flaggedUniqueSentences, 67);
  assert.equal(baseline.sentences.length, 67);
  assert.equal(baseline.sentences.filter((entry) => entry.classification === 'pp-ownership-scope').length, 45);
  assert.equal(baseline.sentences.filter((entry) => entry.classification === 'automatic-upper-tier-coverage-hole').length, 22);
  for (const entry of baseline.sentences) {
    const source = sourceById.get(entry.itemId)?.en;
    assert.ok(source, `missing source item ${entry.itemId}`);
    assert.equal(generatedById.get(entry.itemId)?.sentences?.[entry.sentenceIndex]?.text, entry.text);
    assert.equal(entry.text, baseline.sentences.find((candidate) => candidate.itemId === entry.itemId
      && candidate.sentenceIndex === entry.sentenceIndex)?.text);
    assert.ok(source.includes(entry.text), `baseline text is not in source ${entry.itemId}`);
    const archived = entry.baselineSentenceRecord;
    assert.equal(archived.text, entry.text);
    const projected = Object.fromEntries(Object.entries(archived.variants).map(([tier, variant]) => [tier,
      variant.tiles.map((tile) => ({ text: tile.text, tokenStart: tile.tokenStart, tokenEnd: tile.tokenEnd,
        role: tile.role, dependency: tile.dependency }))]));
    assert.deepEqual(entry.baselineVariants, projected, `incomplete archived variants for ${entry.itemId}/${entry.sentenceIndex}`);
  }
});

test('the archived long-PP cohort no longer grants PP ownership over nested clauses', () => {
  let auditedNestedPpSpans = 0;
  for (const entry of baseline.sentences.filter((value) => value.classification === 'pp-ownership-scope')) {
    const value = sentence(entry.itemId, entry.sentenceIndex);
    for (const oldTiles of Object.values(entry.baselineVariants)) {
      for (const oldTile of oldTiles) {
        if (oldTile.role !== 'pp') continue;
        const lexicalWords = value.tokens.slice(oldTile.tokenStart, oldTile.tokenEnd)
          .filter((token) => !token.isPunct && !['PUNCT', 'SYM'].includes(token.pos)).length;
        if (lexicalWords < 8) continue;
        const hadNestedClause = entry.baselineSentenceRecord.tokens.slice(oldTile.tokenStart, oldTile.tokenEnd)
          .some((token) => clauseRelations.has(token.dep)
            || token.dep === 'pcomp' && ['VERB', 'AUX'].includes(token.pos)
            || token.dep === 'conj' && ['VERB', 'AUX'].includes(token.pos));
        if (!hadNestedClause) continue;
        auditedNestedPpSpans += 1;
        for (const tier of ['standard', 'precision']) {
          if (!value.variants?.[tier]) {
            assert.ok(typeof value.tierUnavailableReason?.[tier] === 'string'
              && value.tierUnavailableReason[tier].trim().length > 0,
            `${entry.itemId}/${entry.sentenceIndex} has an unexplained ${tier} gap`);
            continue;
          }
          assert.ok(!value.variants[tier].tiles.some((tile) => tile.ownerKind === 'pp'
            && tile.tokenStart <= oldTile.tokenStart && tile.tokenEnd >= oldTile.tokenEnd),
          `${entry.itemId}/${entry.sentenceIndex}/${tier} kept a nested clause inside whole-span PP ownership`);
        }
      }
    }
  }
  assert.ok(auditedNestedPpSpans > 0, 'the retained audit cohort contains no nested long-PP spans');
});

test('each tile reports an immutable structural owner and source dependency head', () => {
  for (const item of metadata.items) {
    for (const value of item.sentences) {
      for (const [tier, variant] of Object.entries(value.variants ?? {})) {
        for (const tile of variant.tiles) {
          assert.ok(typeof tile.ownerKind === 'string' && tile.ownerKind.length > 0,
            `${item.itemId}/${value.sentenceIndex}/${tier}/${tile.id}: missing ownerKind`);
          assert.ok(typeof tile.ownerRelation === 'string' && tile.ownerRelation.length > 0,
            `${item.itemId}/${value.sentenceIndex}/${tier}/${tile.id}: missing ownerRelation`);
          assert.ok(Number.isInteger(tile.ownerHead) && tile.ownerHead >= 0 && tile.ownerHead < value.tokens.length,
            `${item.itemId}/${value.sentenceIndex}/${tier}/${tile.id}: invalid ownerHead`);
          if (tile.ownerKind === 'pp') {
            assert.ok(['prep', 'obl', 'agent', 'dative'].includes(tile.ownerRelation.toLowerCase()),
              `${item.itemId}/${value.sentenceIndex}/${tier}/${tile.id}: PP has non-PP dependency owner`);
          }
        }
      }
    }
  }
});

test('upper-tier gaps always carry a reason, and the five coarse manual overrides regain both upper tiers', () => {
  for (const item of metadata.items) {
    for (const value of item.sentences) {
      if (value.fixedContext || value.excludedReason) continue;
      for (const tier of ['foundation', 'standard', 'precision']) {
        if (!value.variants?.[tier]) {
          assert.ok(typeof value.tierUnavailableReason?.[tier] === 'string'
            && value.tierUnavailableReason[tier].trim().length > 0,
          `${item.itemId}/${value.sentenceIndex}: unexplained ${tier} unavailability`);
        }
      }
    }
  }
  for (const [itemId, sentenceIndex] of [['E0022', 0], ['E0075', 0], ['E0241', 0], ['E0309', 0], ['E0544', 0]]) {
    const value = sentence(itemId, sentenceIndex);
    assert.ok(value.variants.standard, `${itemId}/${sentenceIndex} has no Standard variant`);
    assert.ok(value.variants.precision, `${itemId}/${sentenceIndex} has no Precision variant`);
  }
});

test('E0110 coordinated clause and its PP keep separate structural ownership', () => {
  const value = sentence('E0110');
  const head = value.tokens.find((token) => token.text.toLowerCase() === 'decided').i;
  const [start, end] = dependencySpan(value, head);
  const cc = value.tokens.find((token) => token.text.toLowerCase() === 'but').i;
  const coordSpan = [cc, end];
  for (const tier of ['standard', 'precision']) {
    const clauseTiles = assertSplit(value, tier, coordSpan);
    const predicateTile = tileAt(value, tier, head);
    assert.ok(predicateTile?.ownerParentKind === 'coordinated-clause'
      || predicateTile?.ownerKind === 'coordinated-clause');
    const clauseCore = clauseTiles.find((tile) => tile.ownerKind === 'coordinated-clause'
      || tile.ownerParentKind === 'coordinated-clause');
    assert.ok(clauseCore, `${tier} has no coordinated-clause owner for its marker/core`);
    assert.ok(!clauseTiles.some((tile) => tile.ownerKind === 'pp'
      && tile.tokenStart <= cc && tile.tokenEnd >= end), `${tier} gave the whole coordinated clause to PP`);
    assert.ok(clauseTiles.every((tile) => tile.tokenEnd - tile.tokenStart < end - start), `${tier} kept the coordinated clause atomic`);
    const rainy = value.tokens.find((token) => token.text.toLowerCase() === 'rainy').i;
    assert.equal(tileAt(value, tier, rainy)?.ownerKind, 'pp');
  }
});

test('E0050 adverbial clause recursively decomposes without PP ownership', () => {
  const value = sentence('E0050');
  const head = value.tokens.find((token) => token.text.toLowerCase() === 'bent').i;
  const [start, end] = dependencySpan(value, head);
  const when = value.tokens.find((token) => token.text.toLowerCase() === 'when').i;
  const span = [when, end];
  const standard = assertSplit(value, 'standard', span);
  assert.equal(tileAt(value, 'standard', head)?.ownerParentKind, 'subordinate-clause');
  assert.ok(!standard.some((tile) => tile.ownerKind === 'pp' && tile.tokenStart <= when && tile.tokenEnd >= end));
  assertSplit(value, 'precision', span);
});

test('E0462 coordinated clause stays a clause while internal PPs stay local', () => {
  const value = sentence('E0462');
  const head = value.tokens.find((token) => token.text.toLowerCase() === 'sentenced').i;
  const [, end] = dependencySpan(value, head);
  const but = value.tokens.find((token) => token.text.toLowerCase() === 'but').i;
  for (const tier of ['standard', 'precision']) {
    const tiles = assertSplit(value, tier, [but, end]);
    assert.equal(tileAt(value, tier, head)?.ownerParentKind, 'coordinated-clause');
    assert.ok(!tiles.some((tile) => tile.ownerKind === 'pp' && tile.tokenStart <= but && tile.tokenEnd >= end));
    const crime = value.tokens.find((token) => token.text.toLowerCase() === 'crime').i;
    assert.equal(tileAt(value, tier, crime)?.ownerKind, 'pp');
  }
});

test('E0018 exposes the relative clause nested in a real PP above Foundation', () => {
  const value = sentence('E0018');
  const relHead = value.tokens.find((token) => token.dep === 'relcl').i;
  const relSpan = dependencySpan(value, relHead);
  const forToken = value.tokens.find((token) => token.text.toLowerCase() === 'for').i;
  const foundationPp = tileAt(value, 'foundation', forToken);
  assert.ok(foundationPp.tokenStart <= forToken && foundationPp.tokenEnd >= relSpan[1],
    'Foundation must keep the complete PP atomic inside its containing constituent');
  for (const tier of ['standard', 'precision']) {
    assertSplit(value, tier, relSpan);
    const relativeOwner = tileAt(value, tier, relHead);
    assert.ok(relativeOwner?.ownerKind === 'relative-clause' || relativeOwner?.ownerParentKind === 'relative-clause');
    assert.equal(tileAt(value, tier, forToken)?.ownerKind, 'pp');
  }
});

test('E0033 protects only the lexical quantity plus noun core, not the relative clause', () => {
  const value = sentence('E0033');
  const protectedText = value.protectedConstructions.filter((span) => span.hard).map((span) => span.text.toLowerCase());
  assert.ok(protectedText.some((text) => /^a lot of vacant lots$/.test(text)), protectedText.join(' | '));
  assert.ok(protectedText.every((text) => !text.includes('which have been')));
  const relHead = value.tokens.find((token) => token.dep === 'relcl').i;
  const relSpan = dependencySpan(value, relHead);
  for (const tier of ['standard', 'precision']) {
    assertSplit(value, tier, relSpan);
    assert.equal(tileAt(value, tier, relHead)?.ownerParentKind, 'relative-clause');
  }
});

test('E0141 Precision recursively decomposes the long embedded clause', () => {
  const value = sentence('E0141');
  const head = value.tokens.find((token) => token.text.toLowerCase() === 'make').i;
  const [start, end] = dependencySpan(value, head);
  const that = value.tokens.find((token) => token.text.toLowerCase() === 'that').i;
  const tiles = assertSplit(value, 'precision', [that, end]);
  assert.ok(tiles.every((tile) => tile.tokenEnd - tile.tokenStart < end - start));
  assert.equal(tileAt(value, 'precision', head)?.ownerParentKind, 'subordinate-clause');
});

test('E0161 Standard recursively decomposes the nested infinitival and before clauses', () => {
  const value = sentence('E0161');
  const look = value.tokens.find((token) => token.text.toLowerCase() === 'look').i;
  const [, end] = dependencySpan(value, look);
  const [start] = dependencySpan(value, look);
  const tiles = assertSplit(value, 'standard', [start, end]);
  assert.equal(tileAt(value, 'standard', look)?.ownerParentKind, 'subordinate-clause');
  assert.ok(tiles.every((tile) => tile.tokenEnd - tile.tokenStart < end - start));
});

test('E0164 recursively exposes a complement clause nested inside a PP', () => {
  const value = sentence('E0164');
  const marker = value.tokens.find((token) => token.text.toLowerCase() === 'whether').i;
  const head = value.tokens.find((token) => token.text.toLowerCase() === 'is').i;
  const [, end] = dependencySpan(value, head);
  for (const tier of ['standard', 'precision']) {
    const nested = assertSplit(value, tier, [marker, end]);
    assert.ok(nested.some((tile) => tile.ownerKind === 'subordinate-clause'
      || tile.ownerParentKind === 'subordinate-clause'));
    assert.equal(tileAt(value, tier, value.tokens.find((token) => token.text.toLowerCase() === 'over').i)?.ownerKind, 'pp');
  }
});

test('E0241 exposes both members of a correlative nominal coordination', () => {
  const value = sentence('E0241');
  for (const tier of ['standard', 'precision']) {
    const blessing = value.tokens.find((token) => token.text.toLowerCase() === 'blessing').i;
    const curse = value.tokens.find((token) => token.text.toLowerCase() === 'curse').i;
    assert.notEqual(tileAt(value, tier, blessing)?.id, tileAt(value, tier, curse)?.id,
      `${tier} left the correlative coordination atomic`);
    assert.equal(tileAt(value, tier, blessing)?.ownerKind, 'coordination');
    assert.equal(tileAt(value, tier, curse)?.ownerKind, 'coordination');
  }
});

test('the independent serialized-metadata audit detects a role/owner mutation', () => {
  const damaged = structuredClone(metadata);
  const item = damaged.items.find((entry) => String(entry.itemId) === 'E0110');
  const value = item.sentences[0];
  const tile = tileAt(value, 'standard', value.tokens.find((token) => token.text.toLowerCase() === 'decided').i);
  tile.role = 'pp';
  assert.ok(auditReorderChunkQuality(damaged).misownedRoleCount > 0);
});

test('chunk quality report closes structural ownership, decomposition, and protection audits', () => {
  const quality = report.chunkQuality;
  assert.ok(quality, 'missing chunkQuality audit report');
  assert.equal(quality.misownedRoleCount, 0);
  assert.equal(quality.decomposableLongTileCountByTier.standard, 0);
  assert.equal(quality.decomposableLongTileCountByTier.precision, 0);
  assert.equal(quality.unexplainedTierUnavailableCount, 0);
  assert.equal(quality.manualCoarseOnlyCount, 0);
  assert.equal(quality.protectedOverreachCount, 0);
  assert.ok(quality.longTileCountByTier.foundation > 0, 'long Foundation tiles should remain allowed');
});
