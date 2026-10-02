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
const legacyOverrideItems = ['E0022', 'E0050', 'E0075', 'E0241', 'E0309', 'E0369', 'E0544'];

function sentence(itemId, sentenceIndex = 0) {
  const value = generatedById.get(itemId)?.sentences?.[sentenceIndex];
  assert.ok(value, `missing generated sentence ${itemId}/${sentenceIndex}`);
  return value;
}

function chunkAt(value, tokenIndex) {
  return value.chunks?.find((chunk) => chunk.tokenStart <= tokenIndex && tokenIndex < chunk.tokenEnd);
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

function chunksIntersecting(value, [start, end]) {
  return value.chunks?.filter((chunk) => chunk.tokenStart < end && chunk.tokenEnd > start) ?? [];
}

function assertSplit(value, span, minimumChunks = 2) {
  const selected = chunksIntersecting(value, span);
  assert.ok(selected.length >= minimumChunks,
    `shared partition leaves a nested constituent in one chunk: ${selected.map((chunk) => chunk.text).join(' / ')}`);
  return selected;
}

test('the pre-change 67-sentence audit cohort remains archived as migration evidence', () => {
  assert.equal(baseline.baselineMainSha, 'b370462dc7a9a1c3d5193752dd2752b91d3a74f7');
  assert.equal(baseline.baselineMetadataSha256, '61c4bdbe8eca6a0211f579b78710c13269d5d0a50a64d4138b13faa7dd26e73a');
  assert.equal(baseline.priorAuditCounts.flaggedUniqueSentences, 67);
  assert.equal(baseline.sentences.length, 67);
  assert.equal(baseline.sentences.filter((entry) => entry.classification === 'pp-ownership-scope').length, 45);
  assert.equal(baseline.sentences.filter((entry) => entry.classification === 'automatic-upper-tier-coverage-hole').length, 22);
  for (const entry of baseline.sentences) {
    const source = sourceById.get(entry.itemId)?.en;
    assert.ok(source, `missing source item ${entry.itemId}`);
    assert.equal(sentence(entry.itemId, entry.sentenceIndex).text, entry.text);
    assert.ok(source.includes(entry.text), `baseline text is not in source ${entry.itemId}`);
    assert.equal(entry.baselineSentenceRecord.text, entry.text);
  }
});

test('the shared partition removes tier authority everywhere', () => {
  assert.equal(metadata.schemaVersion, 2);
  assert.deepEqual(metadata.partitionPolicy, {
    kind: 'shared',
    minTiles: 2,
    targetMaxTiles: 8,
    levelInvariant: true,
    asrReusable: true,
  });
  assert.equal(Object.hasOwn(metadata, 'tierRules'), false);
  let playable = 0;
  for (const item of metadata.items) {
    for (const value of item.sentences) {
      assert.equal(Object.hasOwn(value, 'variants'), false, `${item.itemId}/${value.sentenceIndex} retained variants`);
      assert.equal(Object.hasOwn(value, 'tierUnavailableReason'), false,
        `${item.itemId}/${value.sentenceIndex} retained tierUnavailableReason`);
      if (value.fixedContext || value.excludedReason) {
        assert.deepEqual(value.chunks, []);
        continue;
      }
      playable += 1;
      assert.ok(value.chunks.length >= 2, `${item.itemId}/${value.sentenceIndex} has no shared partition`);
      assert.equal(value.canonicalOrder.length, value.chunks.length);
      assert.equal(value.acceptedOrders.some((order) => JSON.stringify(order) === JSON.stringify(value.canonicalOrder)), true);
      assert.equal(value.chunks.map((chunk) => chunk.text + chunk.separatorAfter).join(''), value.text);
      assert.equal(value.canonicalReconstruction, value.text);
    }
  }
  assert.equal(playable, report.playableSentenceCount);
  assert.equal(playable, report.sharedPartitionCount);
});

test('legacy Foundation-only manual corrections are no longer production authorities', () => {
  for (const itemId of legacyOverrideItems) {
    const value = sentence(itemId);
    assert.equal(value.manualOverrideApplied, false, `${itemId} still depends on a legacy tier override`);
    assert.ok(value.chunks.length >= 2, `${itemId} did not regenerate a shared partition`);
  }
  assert.deepEqual(report.manualOverrideMigration.removedLegacyTierOnlyItems, legacyOverrideItems);
  assert.equal(report.manualOverrideMigration.remainingManualChunkOverrideCount, 0);
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
        assert.ok(!value.chunks.some((chunk) => chunk.ownerKind === 'pp'
          && chunk.tokenStart <= oldTile.tokenStart && chunk.tokenEnd >= oldTile.tokenEnd),
        `${entry.itemId}/${entry.sentenceIndex} kept a nested clause inside whole-span PP ownership`);
      }
    }
  }
  assert.ok(auditedNestedPpSpans > 0, 'the retained audit cohort contains no nested long-PP spans');
});

test('each shared chunk reports a structural owner and source dependency head', () => {
  for (const item of metadata.items) {
    for (const value of item.sentences) {
      for (const chunk of value.chunks ?? []) {
        assert.ok(typeof chunk.ownerKind === 'string' && chunk.ownerKind.length > 0,
          `${item.itemId}/${value.sentenceIndex}/${chunk.id}: missing ownerKind`);
        assert.ok(typeof chunk.ownerRelation === 'string' && chunk.ownerRelation.length > 0,
          `${item.itemId}/${value.sentenceIndex}/${chunk.id}: missing ownerRelation`);
        assert.ok(Number.isInteger(chunk.ownerHead) && chunk.ownerHead >= 0 && chunk.ownerHead < value.tokens.length,
          `${item.itemId}/${value.sentenceIndex}/${chunk.id}: invalid ownerHead`);
        if (chunk.ownerKind === 'pp') {
          assert.ok(['prep', 'obl', 'agent', 'dative'].includes(chunk.ownerRelation.toLowerCase()),
            `${item.itemId}/${value.sentenceIndex}/${chunk.id}: PP has non-PP dependency owner`);
        }
      }
    }
  }
});

test('E0110 coordinated clause and its PP keep separate structural ownership', () => {
  const value = sentence('E0110');
  const head = value.tokens.find((token) => token.text.toLowerCase() === 'decided').i;
  const [start, end] = dependencySpan(value, head);
  const cc = value.tokens.find((token) => token.text.toLowerCase() === 'but').i;
  const clauseChunks = assertSplit(value, [cc, end]);
  const predicateChunk = chunkAt(value, head);
  assert.ok(predicateChunk?.ownerParentKind === 'coordinated-clause'
    || predicateChunk?.ownerKind === 'coordinated-clause');
  assert.ok(clauseChunks.some((chunk) => chunk.ownerKind === 'coordinated-clause'
    || chunk.ownerParentKind === 'coordinated-clause'));
  assert.ok(!clauseChunks.some((chunk) => chunk.ownerKind === 'pp'
    && chunk.tokenStart <= cc && chunk.tokenEnd >= end));
  assert.ok(clauseChunks.every((chunk) => chunk.tokenEnd - chunk.tokenStart < end - start));
  const rainy = value.tokens.find((token) => token.text.toLowerCase() === 'rainy').i;
  assert.equal(chunkAt(value, rainy)?.ownerKind, 'pp');
});

test('E0050 adverbial clause recursively decomposes without PP ownership', () => {
  const value = sentence('E0050');
  const head = value.tokens.find((token) => token.text.toLowerCase() === 'bent').i;
  const [, end] = dependencySpan(value, head);
  const when = value.tokens.find((token) => token.text.toLowerCase() === 'when').i;
  const chunks = assertSplit(value, [when, end]);
  assert.equal(chunkAt(value, head)?.ownerParentKind, 'subordinate-clause');
  assert.ok(!chunks.some((chunk) => chunk.ownerKind === 'pp' && chunk.tokenStart <= when && chunk.tokenEnd >= end));
});

test('E0462 coordinated clause stays a clause while internal PPs stay local', () => {
  const value = sentence('E0462');
  const head = value.tokens.find((token) => token.text.toLowerCase() === 'sentenced').i;
  const [, end] = dependencySpan(value, head);
  const but = value.tokens.find((token) => token.text.toLowerCase() === 'but').i;
  const chunks = assertSplit(value, [but, end]);
  assert.equal(chunkAt(value, head)?.ownerParentKind, 'coordinated-clause');
  assert.ok(!chunks.some((chunk) => chunk.ownerKind === 'pp' && chunk.tokenStart <= but && chunk.tokenEnd >= end));
  const crime = value.tokens.find((token) => token.text.toLowerCase() === 'crime').i;
  assert.equal(chunkAt(value, crime)?.ownerKind, 'pp');
});

test('E0018 exposes the relative clause nested in a real PP', () => {
  const value = sentence('E0018');
  const relHead = value.tokens.find((token) => token.dep === 'relcl').i;
  assertSplit(value, dependencySpan(value, relHead));
  const relativeOwner = chunkAt(value, relHead);
  assert.ok(relativeOwner?.ownerKind === 'relative-clause' || relativeOwner?.ownerParentKind === 'relative-clause');
  const forToken = value.tokens.find((token) => token.text.toLowerCase() === 'for').i;
  assert.equal(chunkAt(value, forToken)?.ownerKind, 'pp');
});

test('E0033 protects only the lexical quantity plus noun core, not the relative clause', () => {
  const value = sentence('E0033');
  const protectedText = value.protectedConstructions.filter((span) => span.hard).map((span) => span.text.toLowerCase());
  assert.ok(protectedText.some((text) => /^a lot of vacant lots$/.test(text)), protectedText.join(' | '));
  assert.ok(protectedText.every((text) => !text.includes('which have been')));
  const relHead = value.tokens.find((token) => token.dep === 'relcl').i;
  assertSplit(value, dependencySpan(value, relHead));
  assert.equal(chunkAt(value, relHead)?.ownerParentKind, 'relative-clause');
});

test('long embedded and infinitival clauses remain recursively decomposed', () => {
  for (const [itemId, headWord, markerWord] of [
    ['E0141', 'make', 'that'],
    ['E0161', 'look', null],
  ]) {
    const value = sentence(itemId);
    const head = value.tokens.find((token) => token.text.toLowerCase() === headWord).i;
    const [start, end] = dependencySpan(value, head);
    const startAt = markerWord ? value.tokens.find((token) => token.text.toLowerCase() === markerWord).i : start;
    const chunks = assertSplit(value, [startAt, end]);
    assert.ok(chunks.every((chunk) => chunk.tokenEnd - chunk.tokenStart < end - start));
    assert.equal(chunkAt(value, head)?.ownerParentKind, 'subordinate-clause');
  }
});

test('E0164 recursively exposes a complement clause nested inside a PP', () => {
  const value = sentence('E0164');
  const marker = value.tokens.find((token) => token.text.toLowerCase() === 'whether').i;
  const head = value.tokens.find((token) => token.text.toLowerCase() === 'is').i;
  const [, end] = dependencySpan(value, head);
  const nested = assertSplit(value, [marker, end]);
  assert.ok(nested.some((chunk) => chunk.ownerKind === 'subordinate-clause'
    || chunk.ownerParentKind === 'subordinate-clause'));
  assert.equal(chunkAt(value, value.tokens.find((token) => token.text.toLowerCase() === 'over').i)?.ownerKind, 'pp');
});

test('E0241 exposes both members of a correlative nominal coordination', () => {
  const value = sentence('E0241');
  const blessing = value.tokens.find((token) => token.text.toLowerCase() === 'blessing').i;
  const curse = value.tokens.find((token) => token.text.toLowerCase() === 'curse').i;
  assert.notEqual(chunkAt(value, blessing)?.id, chunkAt(value, curse)?.id,
    'shared partition left the correlative coordination atomic');
  assert.equal(chunkAt(value, blessing)?.ownerKind, 'coordination');
  assert.equal(chunkAt(value, curse)?.ownerKind, 'coordination');
});

test('syntactic function words are never standalone chunks', () => {
  const functionPos = new Set(['DET', 'ADP', 'AUX', 'CCONJ', 'SCONJ', 'PART']);
  const functionDeps = new Set(['cc', 'mark', 'det', 'case', 'aux', 'aux:pass', 'auxpass', 'neg']);
  const offenders = [];
  for (const item of metadata.items) {
    for (const value of item.sentences) {
      for (const chunk of value.chunks ?? []) {
        const lexical = value.tokens.slice(chunk.tokenStart, chunk.tokenEnd)
          .filter((token) => !token.isPunct && !['PUNCT', 'SYM'].includes(token.pos));
        if (lexical.length === 1 && (functionPos.has(lexical[0].pos) || functionDeps.has(lexical[0].dep))) {
          offenders.push(`${item.itemId}/${value.sentenceIndex}: ${chunk.text} [${lexical[0].pos}/${lexical[0].dep}]`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
  assert.equal(report.chunkQuality.standaloneFunctionWordChunkCount, 0);
});

test('the independent serialized-metadata audit detects a role/owner mutation', () => {
  const damaged = structuredClone(metadata);
  const value = damaged.items.find((entry) => String(entry.itemId) === 'E0110').sentences[0];
  chunkAt(value, value.tokens.find((token) => token.text.toLowerCase() === 'decided').i).role = 'pp';
  assert.ok(auditReorderChunkQuality(damaged).misownedRoleCount > 0);
});

test('chunk quality report closes ownership, decomposition, protection and tile-load audits', () => {
  const quality = report.chunkQuality;
  assert.ok(quality, 'missing chunkQuality audit report');
  assert.deepEqual(quality, auditReorderChunkQuality(metadata));
  assert.equal(quality.misownedRoleCount, 0);
  assert.equal(quality.decomposableLongChunkCount, 0);
  assert.equal(quality.protectedOverreachCount, 0);
  assert.equal(Object.values(quality.tileCountDistribution).reduce((sum, value) => sum + value, 0),
    report.playableSentenceCount);
  assert.equal(quality.tileCountDistribution['1'], 0);
  for (const entry of quality.overEight) {
    assert.ok(entry.tileCount > 8);
    assert.equal(sentence(entry.itemId, entry.sentenceIndex).chunks.length, entry.tileCount);
  }
});
