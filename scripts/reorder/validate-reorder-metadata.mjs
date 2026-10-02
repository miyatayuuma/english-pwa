import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_VERSION = 2;
const POLICY_VERSION = 'reorder-policy-2.0.0';
const TARGET_MAX_TILES = 8;
const CLAUSE_RELATIONS = new Set(['advcl', 'acl', 'acl:relcl', 'relcl', 'ccomp', 'xcomp', 'csubj', 'csubjpass']);
const SUBJECT_RELATIONS = new Set(['nsubj', 'csubj', 'nsubjpass', 'csubjpass']);
const OBJECT_RELATIONS = new Set(['obj', 'dobj', 'iobj', 'dative']);
const STRUCTURAL_CHILD_RELATIONS = new Set([...CLAUSE_RELATIONS, ...SUBJECT_RELATIONS, ...OBJECT_RELATIONS,
  'prep', 'obl', 'agent', 'attr', 'acomp', 'oprd']);
const PP_OWNER_RELATIONS = new Set(['prep', 'obl', 'agent', 'dative']);
const FUNCTION_WORDS = new Set(['the', 'a', 'an', 'to', 'had', 'has', 'have', 'do', 'does', 'did', 'not', 'because', 'but', 'and', 'or']);

const hash = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const fail = (errors, code, detail) => errors.push({ code, detail });

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

function hasIndependentLegalSplit(tokens, sentence, chunk) {
  const start = chunk.tokenStart;
  const end = chunk.tokenEnd;
  if (chunk.ownerKind === 'structural-composite') return false;
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
  const ownerHead = chunk.ownerHead;
  if (Number.isInteger(ownerHead)
    && ['main-clause', 'coordinated-clause', 'subordinate-clause', 'relative-clause'].includes(chunk.ownerKind)) {
    const children = tokens.slice(start, end).filter((token) => token.head === ownerHead
      && STRUCTURAL_CHILD_RELATIONS.has(token.dep));
    if (children.length >= 2
      && children.some((token) => start < token.i && token.i < end && !isProtectedBoundary(sentence, token.i))) return true;
  }
  return false;
}

/** Recount shared-partition quality only from serialized metadata. */
export function auditReorderChunkQuality(metadata) {
  const tileCountDistribution = { '1': 0, '2-3': 0, '4-5': 0, '6-8': 0, '>8': 0 };
  const overEight = [];
  const standaloneFunctionWordChunks = [];
  let longChunkCount = 0;
  let decomposableLongChunkCount = 0;
  let misownedRoleCount = 0;
  let protectedOverreachCount = 0;
  let maxTileCount = 0;

  for (const item of metadata?.items ?? []) {
    for (const sentence of item.sentences ?? []) {
      const chunks = sentence.chunks ?? [];
      if (!chunks.length) continue;
      const count = chunks.length;
      maxTileCount = Math.max(maxTileCount, count);
      const bucket = count === 1 ? '1' : count <= 3 ? '2-3' : count <= 5 ? '4-5' : count <= 8 ? '6-8' : '>8';
      tileCountDistribution[bucket] += 1;
      if (count > TARGET_MAX_TILES) overEight.push({ itemId: item.itemId, sentenceIndex: sentence.sentenceIndex, tileCount: count });
      const tokens = sentence.tokens ?? [];
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
      for (const chunk of chunks) {
        const words = lexicalCount(tokens, chunk.tokenStart, chunk.tokenEnd);
        if (words >= 8) {
          longChunkCount += 1;
          if (hasIndependentLegalSplit(tokens, sentence, chunk)) decomposableLongChunkCount += 1;
        }
        const lexical = tokens.slice(chunk.tokenStart, chunk.tokenEnd)
          .filter((token) => !token.isPunct && !['PUNCT', 'SYM'].includes(token.pos));
        if (lexical.length === 1 && FUNCTION_WORDS.has(String(lexical[0].text).toLowerCase())) {
          standaloneFunctionWordChunks.push({ itemId: item.itemId, sentenceIndex: sentence.sentenceIndex,
            text: chunk.text, token: lexical[0].text });
        }
        const ownerHead = chunk.ownerHead;
        const ownerValid = typeof chunk.ownerKind === 'string' && chunk.ownerKind.length > 0
          && typeof chunk.ownerRelation === 'string' && chunk.ownerRelation.length > 0
          && Number.isInteger(ownerHead) && ownerHead >= 0 && ownerHead < tokens.length;
        if (!ownerValid
          || chunk.role === 'pp' && chunk.ownerKind !== 'pp'
          || chunk.ownerKind === 'pp' && chunk.role !== 'pp'
          || chunk.ownerKind === 'pp' && !PP_OWNER_RELATIONS.has(String(chunk.ownerRelation).toLowerCase())
          || chunk.ownerKind !== 'protected-expression'
            && ownerValid && chunk.ownerRelation.toLowerCase() !== String(tokens[ownerHead].dep).toLowerCase()) {
          misownedRoleCount += 1;
        }
      }
    }
  }
  return {
    tileCountDistribution,
    maxTileCount,
    overEightCount: overEight.length,
    overEight,
    longChunkCount,
    decomposableLongChunkCount,
    standaloneFunctionWordChunkCount: standaloneFunctionWordChunks.length,
    standaloneFunctionWordChunks: standaloneFunctionWordChunks.slice(0, 50),
    misownedRoleCount,
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
  if ([...source].filter((char) => char === '"').length % 2) errors.push('unmatched-ascii-double');
  return errors;
}

export function validateReorderMetadata(items, metadata) {
  const errors = [];
  const report = {
    itemCount: 0, sentenceCount: 0, playableSentenceCount: 0, fixedContextCount: 0,
    excludedSentenceCount: 0, sharedPartitionCount: 0, manualOverrideCount: 0,
    protectedConstructionCount: 0, crossSentenceViolationCount: 0, reconstructionViolationCount: 0,
    failureCount: 0,
  };
  if (!Array.isArray(items) || items.length !== 560) fail(errors, 'item-count', `expected 560, received ${items?.length}`);
  if (metadata?.schemaVersion !== SCHEMA_VERSION) fail(errors, 'schema-version', `expected ${SCHEMA_VERSION}, received ${metadata?.schemaVersion}`);
  if (metadata?.parser?.engine !== 'spaCy' || metadata?.parser?.version !== '3.8.16'
    || metadata?.parser?.model !== 'en_core_web_sm' || metadata?.parser?.modelVersion !== '3.8.0'
    || metadata?.parser?.policyVersion !== POLICY_VERSION) fail(errors, 'parser-authority', JSON.stringify(metadata?.parser));
  if (metadata?.partitionPolicy?.kind !== 'shared' || metadata?.partitionPolicy?.targetMaxTiles !== TARGET_MAX_TILES
    || metadata?.partitionPolicy?.levelInvariant !== true || metadata?.partitionPolicy?.asrReusable !== true) {
    fail(errors, 'partition-policy', JSON.stringify(metadata?.partitionPolicy));
  }
  if ('tierRules' in (metadata ?? {})) fail(errors, 'legacy-tier-authority', 'tierRules must not exist');
  if (!Array.isArray(metadata?.items)) fail(errors, 'metadata-items', 'items must be an array');
  const sourceById = new Map((Array.isArray(items) ? items : []).map((item) => [String(item?.id), item]));
  const metadataById = new Map((metadata?.items ?? []).map((item) => [String(item?.itemId), item]));
  if (metadataById.size !== (metadata?.items?.length ?? 0)) fail(errors, 'duplicate-metadata-item', 'itemId must be unique');
  if (sourceById.size !== metadataById.size) fail(errors, 'coverage', `${sourceById.size} source ids / ${metadataById.size} metadata ids`);
  if (metadata?.source?.sha256 !== hash(JSON.stringify(items))) fail(errors, 'dataset-hash', 'metadata was generated from a different items.json');

  for (const [itemId, source] of sourceById) {
    const item = metadataById.get(itemId);
    if (!item) { fail(errors, 'missing-item', itemId); continue; }
    report.itemCount += 1;
    const text = String(source?.en ?? '');
    if (item.sourceHash !== hash(text)) fail(errors, 'sourceHash-mismatch', itemId);
    if (!Array.isArray(item.sentences) || item.sentenceCount !== item.sentences.length || !item.sentences.length) {
      fail(errors, 'sentence-coverage', `${itemId}: invalid sentence list`); continue;
    }
    for (const quoteError of quoteErrors(text)) fail(errors, 'unmatched-quote', `${itemId}: ${quoteError}`);
    const sentenceRanges = [];
    let itemHasPlayable = false;
    let itemHasExcluded = false;
    for (const sentence of item.sentences) {
      report.sentenceCount += 1;
      const context = `${itemId}/s${sentence.sentenceIndex}`;
      if ('variants' in sentence || 'tierUnavailableReason' in sentence) fail(errors, 'legacy-tier-authority', context);
      if (sentence.manualOverrideApplied) report.manualOverrideCount += 1;
      if (!Number.isInteger(sentence.charStart) || !Number.isInteger(sentence.charEnd)
        || sentence.charStart < 0 || sentence.charEnd <= sentence.charStart || sentence.charEnd > text.length) {
        fail(errors, 'unknown-sentence-span', context); report.crossSentenceViolationCount += 1; continue;
      }
      sentenceRanges.push([sentence.charStart, sentence.charEnd]);
      if (sentence.text !== text.slice(sentence.charStart, sentence.charEnd)) {
        fail(errors, 'sentence-source-mismatch', context); report.reconstructionViolationCount += 1;
      }
      const tokens = sentence.tokens;
      if (!Array.isArray(tokens) || !tokens.length) { fail(errors, 'sentence-tokenization-empty', context); continue; }
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.i !== index || token.start < sentence.charStart || token.end <= token.start || token.end > sentence.charEnd
          || text.slice(token.start, token.end) !== token.text) {
          fail(errors, 'token-span', `${context}: token ${index}`); report.crossSentenceViolationCount += 1;
        }
      }
      const chunks = sentence.chunks ?? [];
      if (sentence.fixedContext) {
        report.fixedContextCount += 1;
        if (chunks.length) fail(errors, 'fixed-context-has-chunks', context);
      } else if (sentence.excludedReason) {
        report.excludedSentenceCount += 1; itemHasExcluded = true;
        if (chunks.length) fail(errors, 'excluded-has-chunks', context);
      } else if (chunks.length >= 2) {
        report.playableSentenceCount += 1; report.sharedPartitionCount += 1; itemHasPlayable = true;
      } else {
        fail(errors, 'unclassified-sentence', context); itemHasExcluded = true;
      }
      report.protectedConstructionCount += sentence.protectedConstructions?.length ?? 0;
      if (!chunks.length) continue;
      const ids = chunks.map((chunk) => chunk.id);
      if (new Set(ids).size !== ids.length) fail(errors, 'duplicate-chunk-id', context);
      if (!Array.isArray(sentence.canonicalOrder) || sentence.canonicalOrder.length !== ids.length
        || sentence.canonicalOrder.some((id, index) => id !== ids[index])) fail(errors, 'canonical-order', context);
      if (!Array.isArray(sentence.acceptedOrders) || !sentence.acceptedOrders.some((order) => JSON.stringify(order) === JSON.stringify(ids))) {
        fail(errors, 'canonical-not-accepted', context);
      }
      for (const [orderIndex, order] of (sentence.acceptedOrders ?? []).entries()) {
        if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length || order.some((id) => !ids.includes(id))) {
          fail(errors, 'invalid-accepted-order', `${context}/order-${orderIndex}`);
        }
      }
      let tokenCursor = 0;
      let reconstructed = '';
      for (const chunk of chunks) {
        if (chunk.tokenStart !== tokenCursor || chunk.tokenEnd <= chunk.tokenStart || chunk.tokenEnd > tokens.length) {
          fail(errors, 'token-loss-duplication-overlap', `${context}/${chunk.id}`);
        }
        tokenCursor = chunk.tokenEnd;
        if (chunk.charStart < sentence.charStart || chunk.charEnd <= chunk.charStart || chunk.charEnd > sentence.charEnd
          || text.slice(chunk.charStart, chunk.charEnd) !== chunk.text) {
          fail(errors, 'chunk-char-span', `${context}/${chunk.id}`); report.crossSentenceViolationCount += 1;
        }
        if (tokens.slice(chunk.tokenStart, chunk.tokenEnd).every((token) => token.isPunct)) fail(errors, 'punctuation-only-chunk', `${context}/${chunk.id}`);
        if (typeof chunk.ownerKind !== 'string' || !chunk.ownerKind || typeof chunk.ownerRelation !== 'string' || !chunk.ownerRelation
          || !Number.isInteger(chunk.ownerHead) || chunk.ownerHead < 0 || chunk.ownerHead >= tokens.length) {
          fail(errors, 'chunk-owner-metadata', `${context}/${chunk.id}`);
        } else if (chunk.ownerKind === 'pp' && chunk.role !== 'pp' || chunk.role === 'pp' && chunk.ownerKind !== 'pp') {
          fail(errors, 'chunk-owner-role-mismatch', `${context}/${chunk.id}`);
        } else if (chunk.ownerKind !== 'protected-expression'
          && chunk.ownerRelation.toLowerCase() !== String(tokens[chunk.ownerHead].dep).toLowerCase()) {
          fail(errors, 'chunk-owner-dependency-mismatch', `${context}/${chunk.id}`);
        }
        const next = chunks[chunks.indexOf(chunk) + 1];
        const expectedSeparator = next ? text.slice(chunk.charEnd, next.charStart) : text.slice(chunk.charEnd, sentence.charEnd);
        if (chunk.separatorAfter !== expectedSeparator) fail(errors, 'separator-span', `${context}/${chunk.id}`);
        reconstructed += chunk.text + chunk.separatorAfter;
      }
      if (tokenCursor !== tokens.length) fail(errors, 'token-coverage', `${context}: ${tokenCursor}/${tokens.length}`);
      if (reconstructed !== sentence.text || sentence.canonicalReconstruction !== sentence.text) {
        fail(errors, 'canonical-reconstruction-mismatch', context); report.reconstructionViolationCount += 1;
      }
      for (const protectedSpan of sentence.protectedConstructions ?? []) {
        if (!protectedSpan.hard) continue;
        const containingChunks = chunks.filter((chunk) => chunk.tokenStart <= protectedSpan.tokenStart && chunk.tokenEnd >= protectedSpan.tokenEnd);
        if (containingChunks.length !== 1) fail(errors, 'hard-mwe-split', `${context}: ${protectedSpan.text}`);
      }
    }
    sentenceRanges.sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < sentenceRanges.length; index += 1) {
      if (sentenceRanges[index][0] < sentenceRanges[index - 1][1]) {
        fail(errors, 'sentence-overlap', itemId); report.crossSentenceViolationCount += 1;
      }
    }
    const covered = new Uint8Array(text.length);
    for (const [start, end] of sentenceRanges) for (let index = start; index < end; index += 1) covered[index] = 1;
    for (let index = 0; index < text.length; index += 1) {
      if (!/\s/u.test(text[index]) && !covered[index]) { fail(errors, 'sentence-boundary-token-loss', `${itemId}: char ${index}`); break; }
    }
    if (itemHasPlayable && itemHasExcluded && item.status !== 'excluded') fail(errors, 'unsafe-partial-item', itemId);
    if (item.status === 'excluded' && !item.sentences.some((sentence) => sentence.excludedReason)) fail(errors, 'classification-status', itemId);
  }
  report.chunkQuality = auditReorderChunkQuality(metadata);
  if (report.chunkQuality.misownedRoleCount !== 0) fail(errors, 'misowned-role', String(report.chunkQuality.misownedRoleCount));
  if (report.chunkQuality.decomposableLongChunkCount !== 0) fail(errors, 'decomposable-long-chunk', String(report.chunkQuality.decomposableLongChunkCount));
  if (report.chunkQuality.protectedOverreachCount !== 0) fail(errors, 'protected-overreach', String(report.chunkQuality.protectedOverreachCount));
  if (report.chunkQuality.standaloneFunctionWordChunkCount > 5) fail(errors, 'function-word-singletons', String(report.chunkQuality.standaloneFunctionWordChunkCount));
  report.failureCount = errors.length;
  return { ok: errors.length === 0, errors, report };
}

function main() {
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));
  const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/reorder-v1.json'), 'utf8'));
  const result = validateReorderMetadata(items, metadata);
  const storedReport = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/reorder-report.json'), 'utf8'));
  const mappings = [
    ['itemCount', 'itemCount'], ['sentenceCount', 'sentenceCount'], ['playableSentenceCount', 'playableSentenceCount'],
    ['fixedContextSentenceCount', 'fixedContextCount'], ['excludedSentenceCount', 'excludedSentenceCount'],
    ['sharedPartitionCount', 'sharedPartitionCount'], ['manualOverrideCount', 'manualOverrideCount'],
    ['protectedConstructionCount', 'protectedConstructionCount'], ['crossSentenceViolationCount', 'crossSentenceViolationCount'],
    ['reconstructionViolationCount', 'reconstructionViolationCount'], ['chunkQuality', 'chunkQuality'],
  ];
  for (const [storedKey, actualKey] of mappings) {
    if (JSON.stringify(storedReport[storedKey]) !== JSON.stringify(result.report[actualKey])) {
      result.errors.push({ code: 'report-mismatch', detail: `${storedKey}: stored/report differ` });
    }
  }
  result.report.failureCount = result.errors.length;
  result.ok = result.errors.length === 0;
  console.log(JSON.stringify(result.report, null, 2));
  if (!result.ok) {
    console.error(JSON.stringify(result.errors.slice(0, 80), null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
