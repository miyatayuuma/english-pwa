import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TIERS = { foundation: [2, 5], standard: [3, 7], precision: [4, 9] };
const hash = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const CLAUSE_RELATIONS = new Set(['advcl', 'acl', 'acl:relcl', 'relcl', 'ccomp', 'xcomp', 'csubj', 'csubjpass']);
const SUBJECT_RELATIONS = new Set(['nsubj', 'csubj', 'nsubjpass', 'csubjpass']);
const OBJECT_RELATIONS = new Set(['obj', 'dobj', 'iobj', 'dative']);
const PP_OWNER_RELATIONS = new Set(['prep', 'obl', 'agent', 'dative']);
const STRUCTURAL_CHILD_RELATIONS = new Set([...CLAUSE_RELATIONS, ...SUBJECT_RELATIONS, ...OBJECT_RELATIONS,
  'prep', 'obl', 'agent', 'attr', 'acomp', 'oprd']);

function fail(errors, code, detail) {
  errors.push({ code, detail });
}

function lexicalCount(tokens, start = 0, end = tokens.length) {
  return tokens.slice(start, end).filter((token) => !token.isPunct && !['PUNCT', 'SYM'].includes(token.pos)).length;
}

function dependencySubtreeSpan(tokens, headIndex) {
  const selected = new Set([headIndex]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const token of tokens) {
      if (!selected.has(token.i) && selected.has(token.head)) {
        selected.add(token.i);
        changed = true;
      }
    }
  }
  return [Math.min(...selected), Math.max(...selected) + 1];
}

function isProtectedBoundary(sentence, boundary) {
  return (sentence.protectedConstructions ?? []).some((span) => span.hard
    && span.tokenStart < boundary && boundary < span.tokenEnd);
}

function hasIndependentLegalSplit(tokens, sentence, tile) {
  const start = tile.tokenStart;
  const end = tile.tokenEnd;
  if (tile.ownerKind === 'structural-composite') return false;
  for (const token of tokens.slice(start, end)) {
    const clauseHead = CLAUSE_RELATIONS.has(token.dep)
      || token.dep === 'pcomp' && ['VERB', 'AUX'].includes(token.pos)
      || token.dep === 'conj' && ['VERB', 'AUX'].includes(token.pos);
    if (!clauseHead) continue;
    const [childStart, childEnd] = dependencySubtreeSpan(tokens, token.i);
    for (const boundary of [childStart, childEnd]) {
      if (start < boundary && boundary < end && !isProtectedBoundary(sentence, boundary)
        && lexicalCount(tokens, start, boundary) > 0 && lexicalCount(tokens, boundary, end) > 0) return true;
    }
  }
  for (const token of tokens.slice(start, end)) {
    if (token.dep !== 'conj') continue;
    const coordinator = tokens.find((candidate) => candidate.head === token.head
      && candidate.dep === 'cc' && candidate.i < token.i);
    const boundary = coordinator?.i ?? token.i;
    if (start < boundary && boundary < end && !isProtectedBoundary(sentence, boundary)
      && lexicalCount(tokens, start, boundary) > 0 && lexicalCount(tokens, boundary, end) > 0) return true;
  }
  const ownerHead = tile.ownerHead;
  if (Number.isInteger(ownerHead)
    && ['main-clause', 'coordinated-clause', 'subordinate-clause', 'relative-clause'].includes(tile.ownerKind)) {
    const children = tokens.slice(start, end).filter((token) => token.head === ownerHead
      && STRUCTURAL_CHILD_RELATIONS.has(token.dep));
    if (children.length >= 2
      && children.some((token) => start < token.i && token.i < end && !isProtectedBoundary(sentence, token.i))) return true;
  }
  return false;
}

/** Recount chunk-quality metrics from serialized spans and dependency tokens only. */
export function auditReorderChunkQuality(metadata) {
  const longTileCountByTier = { foundation: 0, standard: 0, precision: 0 };
  const dominantTileCountByTier = { foundation: 0, standard: 0, precision: 0 };
  const decomposableLongTileCountByTier = { foundation: 0, standard: 0, precision: 0 };
  const tierUnavailableCountByTier = { foundation: 0, standard: 0, precision: 0 };
  let misownedRoleCount = 0;
  let unexplainedTierUnavailableCount = 0;
  let manualCoarseOnlyCount = 0;
  let protectedOverreachCount = 0;

  for (const item of metadata?.items ?? []) {
    for (const sentence of item.sentences ?? []) {
      const tokens = sentence.tokens ?? [];
      const sentenceLexicalCount = lexicalCount(tokens);
      const variants = sentence.variants ?? {};
      if (!sentence.fixedContext && !sentence.excludedReason) {
        if (sentence.manualOverrideApplied && variants.foundation
          && !variants.standard && !variants.precision) manualCoarseOnlyCount += 1;
        for (const tier of Object.keys(TIERS)) {
          if (variants[tier]) continue;
          tierUnavailableCountByTier[tier] += 1;
          if (typeof sentence.tierUnavailableReason?.[tier] !== 'string'
            || sentence.tierUnavailableReason[tier].trim().length === 0) unexplainedTierUnavailableCount += 1;
        }
      }
      for (const protectedSpan of sentence.protectedConstructions ?? []) {
        if (!protectedSpan.hard) continue;
        const selected = new Set(Array.from({ length: protectedSpan.tokenEnd - protectedSpan.tokenStart },
          (_, offset) => protectedSpan.tokenStart + offset));
        if ([...selected].some((index) => selected.has(tokens[index]?.head)
          && (CLAUSE_RELATIONS.has(tokens[index]?.dep)
            || tokens[index]?.dep === 'pcomp' && ['VERB', 'AUX'].includes(tokens[index]?.pos)
            || tokens[index]?.dep === 'conj' && ['VERB', 'AUX'].includes(tokens[index]?.pos)))) {
          protectedOverreachCount += 1;
        }
      }
      for (const [tier, variant] of Object.entries(variants)) {
        if (!Object.hasOwn(TIERS, tier)) continue;
        for (const tile of variant.tiles ?? []) {
          const words = lexicalCount(tokens, tile.tokenStart, tile.tokenEnd);
          if (words >= 8) {
            longTileCountByTier[tier] += 1;
            if (['standard', 'precision'].includes(tier) && hasIndependentLegalSplit(tokens, sentence, tile)) {
              decomposableLongTileCountByTier[tier] += 1;
            }
          }
          if (words >= 12 || words >= 8 && sentenceLexicalCount > 0 && words / sentenceLexicalCount >= 0.65) {
            dominantTileCountByTier[tier] += 1;
          }
          const ownerHead = tile.ownerHead;
          const ownerValid = typeof tile.ownerKind === 'string' && tile.ownerKind.length > 0
            && typeof tile.ownerRelation === 'string' && tile.ownerRelation.length > 0
            && Number.isInteger(ownerHead) && ownerHead >= 0 && ownerHead < tokens.length;
          if (!ownerValid
            || tile.role === 'pp' && tile.ownerKind !== 'pp'
            || tile.ownerKind === 'pp' && tile.role !== 'pp'
            || tile.ownerKind === 'pp' && !PP_OWNER_RELATIONS.has(String(tile.ownerRelation).toLowerCase())
            || tile.ownerKind !== 'protected-expression'
              && ownerValid && tile.ownerRelation.toLowerCase() !== String(tokens[ownerHead].dep).toLowerCase()) {
            misownedRoleCount += 1;
          }
        }
      }
    }
  }
  return {
    longTileCountByTier,
    dominantTileCountByTier,
    decomposableLongTileCountByTier,
    misownedRoleCount,
    tierUnavailableCountByTier,
    unexplainedTierUnavailableCount,
    manualCoarseOnlyCount,
    protectedOverreachCount,
  };
}

function quoteErrors(source) {
  const errors = [];
  for (const [left, right, name] of [['“', '”', 'curly-double'], ['‘', '’', 'curly-single'], ['«', '»', 'guillemet']]) {
    let balance = 0;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (name === 'curly-single' && char === right && index > 0 && index + 1 < source.length
        && /[\p{L}\p{N}]/u.test(source[index - 1]) && /[\p{L}\p{N}]/u.test(source[index + 1])) continue;
      if (char === left) balance += 1;
      if (char === right) balance -= 1;
      if (balance < 0) return [`misordered-${name}`];
    }
    if (balance !== 0) errors.push(`unmatched-${name}`);
  }
  const asciiDouble = [...source].filter((char) => char === '"').length;
  if (asciiDouble % 2) errors.push('unmatched-ascii-double');
  return errors;
}

export function validateReorderMetadata(items, metadata) {
  const errors = [];
  const report = {
    itemCount: 0,
    sentenceCount: 0,
    playableSentenceCount: 0,
    fixedContextCount: 0,
    excludedSentenceCount: 0,
    variantCountByTier: { foundation: 0, standard: 0, precision: 0 },
    manualOverrideCount: 0,
    protectedConstructionCount: 0,
    crossSentenceViolationCount: 0,
    reconstructionViolationCount: 0,
    failureCount: 0,
  };
  if (!Array.isArray(items) || items.length !== 560) fail(errors, 'item-count', `expected 560, received ${items?.length}`);
  if (metadata?.schemaVersion !== 1) fail(errors, 'schema-version', `expected 1, received ${metadata?.schemaVersion}`);
  if (metadata?.parser?.engine !== 'spaCy' || metadata?.parser?.version !== '3.8.16'
    || metadata?.parser?.model !== 'en_core_web_sm' || metadata?.parser?.modelVersion !== '3.8.0'
    || metadata?.parser?.policyVersion !== 'reorder-policy-1.1.0') {
    fail(errors, 'parser-authority', JSON.stringify(metadata?.parser));
  }
  if (!Array.isArray(metadata?.items)) fail(errors, 'metadata-items', 'items must be an array');
  const sourceById = new Map((Array.isArray(items) ? items : []).map((item) => [String(item?.id), item]));
  const metadataById = new Map((metadata?.items ?? []).map((item) => [String(item?.itemId), item]));
  if (metadataById.size !== (metadata?.items?.length ?? 0)) fail(errors, 'duplicate-metadata-item', 'itemId must be unique');
  if (sourceById.size !== (items?.length ?? 0)) fail(errors, 'duplicate-source-item', 'source item id must be unique');
  if (sourceById.size !== metadataById.size) fail(errors, 'coverage', `${sourceById.size} source ids / ${metadataById.size} metadata ids`);
  const expectedSourceHash = hash(JSON.stringify(items));
  if (metadata?.source?.sha256 !== expectedSourceHash) fail(errors, 'dataset-hash', 'metadata was generated from a different items.json');

  for (const [itemId, source] of sourceById) {
    const item = metadataById.get(itemId);
    if (!item) {
      fail(errors, 'missing-item', itemId);
      continue;
    }
    report.itemCount += 1;
    if (item.sourceHash !== hash(String(source?.en ?? ''))) fail(errors, 'sourceHash-mismatch', itemId);
    if (!Array.isArray(item.sentences) || item.sentenceCount !== item.sentences.length || !item.sentences.length) {
      fail(errors, 'sentence-coverage', `${itemId}: invalid sentence list`);
      continue;
    }
    const text = String(source?.en ?? '');
    for (const quoteError of quoteErrors(text)) fail(errors, 'unmatched-quote', `${itemId}: ${quoteError}`);
    const sentenceRanges = [];
    let itemHasPlayable = false;
    let itemHasExcluded = false;
    for (const sentence of item.sentences) {
      report.sentenceCount += 1;
      const context = `${itemId}/s${sentence.sentenceIndex}`;
      if (sentence.manualOverrideApplied) report.manualOverrideCount += 1;
      if (!Number.isInteger(sentence.charStart) || !Number.isInteger(sentence.charEnd)
        || sentence.charStart < 0 || sentence.charEnd <= sentence.charStart || sentence.charEnd > text.length) {
        fail(errors, 'unknown-sentence-span', context);
        report.crossSentenceViolationCount += 1;
        continue;
      }
      sentenceRanges.push([sentence.charStart, sentence.charEnd]);
      if (sentence.text !== text.slice(sentence.charStart, sentence.charEnd)) {
        fail(errors, 'sentence-source-mismatch', context);
        report.reconstructionViolationCount += 1;
      }
      const tokens = sentence.tokens;
      if (!Array.isArray(tokens) || !tokens.length) {
        fail(errors, 'sentence-tokenization-empty', context);
        continue;
      }
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.i !== index || token.start < sentence.charStart || token.end <= token.start || token.end > sentence.charEnd
          || text.slice(token.start, token.end) !== token.text) {
          fail(errors, 'token-span', `${context}: token ${index}`);
          report.crossSentenceViolationCount += 1;
        }
      }
      const variants = sentence.variants ?? {};
      if (sentence.fixedContext) {
        report.fixedContextCount += 1;
        if (Object.keys(variants).length) fail(errors, 'fixed-context-has-variant', context);
      } else if (sentence.excludedReason) {
        report.excludedSentenceCount += 1;
        itemHasExcluded = true;
        if (Object.keys(variants).length) fail(errors, 'excluded-has-variant', context);
      } else if (Object.keys(variants).length) {
        report.playableSentenceCount += 1;
        itemHasPlayable = true;
      } else {
        fail(errors, 'unclassified-sentence', context);
        itemHasExcluded = true;
      }
      report.protectedConstructionCount += sentence.protectedConstructions?.length ?? 0;
      for (const [tier, variant] of Object.entries(variants)) {
        const tierBounds = TIERS[tier];
        if (!tierBounds) {
          fail(errors, 'unknown-tier', `${context}: ${tier}`);
          continue;
        }
        if (!Array.isArray(variant.tiles) || variant.tiles.length < tierBounds[0] || variant.tiles.length > tierBounds[1]) {
          fail(errors, 'tile-count', `${context}/${tier}: ${variant.tiles?.length}`);
          continue;
        }
        report.variantCountByTier[tier] += 1;
        const ids = variant.tiles.map((tile) => tile.id);
        if (new Set(ids).size !== ids.length) fail(errors, 'duplicate-tile-id', `${context}/${tier}`);
        const canonical = variant.canonicalOrder;
        if (!Array.isArray(canonical) || canonical.length !== ids.length || canonical.some((id, index) => id !== ids[index])) {
          fail(errors, 'canonical-order', `${context}/${tier}`);
        }
        if (!Array.isArray(variant.acceptedOrders) || !variant.acceptedOrders.some((order) => JSON.stringify(order) === JSON.stringify(canonical))) {
          fail(errors, 'canonical-not-accepted', `${context}/${tier}`);
        }
        for (const [orderIndex, order] of (variant.acceptedOrders ?? []).entries()) {
          if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length
            || order.some((id) => !ids.includes(id))) {
            fail(errors, 'invalid-accepted-order', `${context}/${tier}/order-${orderIndex}`);
          }
        }
        let tokenCursor = 0;
        let reconstructed = '';
        for (let tileIndex = 0; tileIndex < variant.tiles.length; tileIndex += 1) {
          const tile = variant.tiles[tileIndex];
          if (tile.tokenStart !== tokenCursor || tile.tokenEnd <= tile.tokenStart || tile.tokenEnd > tokens.length) {
            fail(errors, 'token-loss-duplication-overlap', `${context}/${tier}/${tile.id}`);
          }
          tokenCursor = tile.tokenEnd;
          if (tile.charStart < sentence.charStart || tile.charEnd <= tile.charStart || tile.charEnd > sentence.charEnd
            || text.slice(tile.charStart, tile.charEnd) !== tile.text) {
            fail(errors, 'tile-char-span', `${context}/${tier}/${tile.id}`);
            report.crossSentenceViolationCount += 1;
          }
          if (tokens.slice(tile.tokenStart, tile.tokenEnd).every((token) => token.isPunct)) {
            fail(errors, 'punctuation-only-tile', `${context}/${tier}/${tile.id}`);
          }
          if (typeof tile.ownerKind !== 'string' || !tile.ownerKind
            || typeof tile.ownerRelation !== 'string' || !tile.ownerRelation
            || !Number.isInteger(tile.ownerHead) || tile.ownerHead < 0 || tile.ownerHead >= tokens.length) {
            fail(errors, 'tile-owner-metadata', `${context}/${tier}/${tile.id}`);
          } else if (tile.ownerKind === 'pp' && tile.role !== 'pp'
            || tile.role === 'pp' && tile.ownerKind !== 'pp') {
            fail(errors, 'tile-owner-role-mismatch', `${context}/${tier}/${tile.id}`);
          } else if (tile.ownerKind !== 'protected-expression'
            && tile.ownerRelation.toLowerCase() !== String(tokens[tile.ownerHead].dep).toLowerCase()) {
            fail(errors, 'tile-owner-dependency-mismatch', `${context}/${tier}/${tile.id}`);
          }
          if (tile.ownerParentHead !== undefined
            && (!Number.isInteger(tile.ownerParentHead) || tile.ownerParentHead < 0 || tile.ownerParentHead >= tokens.length)) {
            fail(errors, 'tile-owner-parent-head', `${context}/${tier}/${tile.id}`);
          }
          const expectedSeparator = tileIndex + 1 < variant.tiles.length
            ? text.slice(tile.charEnd, variant.tiles[tileIndex + 1].charStart)
            : text.slice(tile.charEnd, sentence.charEnd);
          if (tile.separatorAfter !== expectedSeparator) fail(errors, 'separator-span', `${context}/${tier}/${tile.id}`);
          reconstructed += tile.text + tile.separatorAfter;
        }
        if (tokenCursor !== tokens.length) fail(errors, 'token-coverage', `${context}/${tier}: ${tokenCursor}/${tokens.length}`);
        if (reconstructed !== sentence.text || variant.canonicalReconstruction !== sentence.text) {
          fail(errors, 'canonical-reconstruction-mismatch', `${context}/${tier}`);
          report.reconstructionViolationCount += 1;
        }
        for (const protectedSpan of sentence.protectedConstructions ?? []) {
          if (!protectedSpan.hard) continue;
          const containingTiles = variant.tiles.filter((tile) => tile.tokenStart <= protectedSpan.tokenStart
            && tile.tokenEnd >= protectedSpan.tokenEnd);
          if (containingTiles.length !== 1) fail(errors, 'hard-mwe-split', `${context}/${tier}: ${protectedSpan.text}`);
        }
      }
    }
    sentenceRanges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sentenceRanges.length; i += 1) {
      if (sentenceRanges[i][0] < sentenceRanges[i - 1][1]) {
        fail(errors, 'sentence-overlap', itemId);
        report.crossSentenceViolationCount += 1;
      }
    }
    const covered = new Uint8Array(text.length);
    for (const [start, end] of sentenceRanges) for (let i = start; i < end; i += 1) covered[i] = 1;
    for (let i = 0; i < text.length; i += 1) {
      if (!/\s/u.test(text[i]) && !covered[i]) {
        fail(errors, 'sentence-boundary-token-loss', `${itemId}: char ${i}`);
        report.crossSentenceViolationCount += 1;
        break;
      }
    }
    if (itemHasPlayable && itemHasExcluded && item.status !== 'excluded') fail(errors, 'unsafe-partial-item', itemId);
    if (item.status === 'excluded' && !item.sentences.some((sentence) => sentence.excludedReason)) fail(errors, 'classification-status', itemId);
  }
  for (const itemId of metadataById.keys()) if (!sourceById.has(itemId)) fail(errors, 'unknown-item', itemId);
  report.chunkQuality = auditReorderChunkQuality(metadata);
  if (report.chunkQuality.misownedRoleCount !== 0) fail(errors, 'misowned-role', String(report.chunkQuality.misownedRoleCount));
  if (report.chunkQuality.decomposableLongTileCountByTier.standard !== 0
    || report.chunkQuality.decomposableLongTileCountByTier.precision !== 0) {
    fail(errors, 'decomposable-long-tile', JSON.stringify(report.chunkQuality.decomposableLongTileCountByTier));
  }
  if (report.chunkQuality.unexplainedTierUnavailableCount !== 0) {
    fail(errors, 'unexplained-tier-unavailable', String(report.chunkQuality.unexplainedTierUnavailableCount));
  }
  if (report.chunkQuality.manualCoarseOnlyCount !== 0) fail(errors, 'manual-coarse-only', String(report.chunkQuality.manualCoarseOnlyCount));
  if (report.chunkQuality.protectedOverreachCount !== 0) fail(errors, 'protected-overreach', String(report.chunkQuality.protectedOverreachCount));
  report.failureCount = errors.length;
  return { ok: errors.length === 0, errors, report };
}

function main() {
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));
  const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/reorder-v1.json'), 'utf8'));
  const result = validateReorderMetadata(items, metadata);
  const storedReport = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/reorder-report.json'), 'utf8'));
  for (const key of ['itemCount', 'sentenceCount', 'playableSentenceCount', 'fixedContextSentenceCount', 'excludedSentenceCount',
    'variantCountByTier', 'manualOverrideCount', 'protectedConstructionCount', 'crossSentenceViolationCount', 'reconstructionViolationCount', 'chunkQuality']) {
    const reportKey = key === 'fixedContextCount' ? 'fixedContextSentenceCount' : key === 'excludedSentenceCount' ? 'excludedSentenceCount' : key;
    const actualKey = key === 'fixedContextSentenceCount' ? 'fixedContextCount' : key === 'excludedSentenceCount' ? 'excludedSentenceCount'
      : key === 'playableSentenceCount' ? 'playableSentenceCount' : key;
    if (JSON.stringify(storedReport[key]) !== JSON.stringify(result.report[actualKey])) {
      result.errors.push({ code: 'report-mismatch', detail: `${key}: ${JSON.stringify(storedReport[key])} / ${JSON.stringify(result.report[actualKey])}` });
    }
  }
  result.report.failureCount = result.errors.length;
  result.ok = result.errors.length === 0;
  console.log(JSON.stringify(result.report, null, 2));
  if (!result.ok) {
    console.error(JSON.stringify(result.errors.slice(0, 50), null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
