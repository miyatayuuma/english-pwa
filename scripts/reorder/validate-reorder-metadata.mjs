#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateCanonicalVariant, createPuzzleState, answerIsCorrect } from './reorderCore.js';
const root = new URL('../../', import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, root), 'utf8'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function expectedLearning(source, start, end) {
  const lexical = new Set();
  for (const pattern of [/\b(?:[A-Za-z]\.){2,}|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|Inc|Ltd)\./gu, /[\p{L}\p{N}]+(?:[-'’/][\p{L}\p{N}]+)+/gu, /(?:\$)?\d+(?:[,:.]\d+)*(?:%)?/gu]) {
    for (const m of source.matchAll(pattern)) for (let i = m.index; i < m.index + m[0].length; i += 1) if (!/[\p{L}\p{N}]/u.test(source[i])) lexical.add(i);
  }
  let open = false;
  for (let i = 0; i < source.length; i += 1) {
    if ("'’".includes(source[i]) && !lexical.has(i)) {
      if (i && source[i - 1].toLowerCase() === 's' && !open) lexical.add(i);
      else open = !open;
    }
    if ('$%'.includes(source[i])) lexical.add(i);
  }
  let result = '';
  let position = start;
  for (const c of source.slice(start, end)) {
    const i = position;
    position += c.length;
    if (/[\p{L}\p{N}\s]/u.test(c) || lexical.has(i)) result += c;
    else if (',.!?:;"\'’‘“”()[]{}—–-«»‹›'.includes(c)) result += ' ';
    else throw new Error(`unclassified punctuation ${c}`);
  }
  return result.replace(/\s+/gu, ' ').trim();
}

export function validateMetadata(items, metadata) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  check(metadata.schemaVersion === 2, 'schema');
  check(metadata.policyVersion === 'shared-chunk-policy-1.0.0', 'policy');
  check(metadata.learningSurfaceVersion === 'shared-learning-surface-1.0.0', 'surface version');
  check(metadata.charOffsetUnit === 'utf16-code-unit', 'char offset unit');
  check(metadata.tokenOffsetUnit === 'sentence-local-half-open', 'token offset unit');
  check(metadata.source.englishManifestSha256 === sha(JSON.stringify(items.map(({ id, en }) => ({ id, en })))), 'source manifest');
  check(metadata.items.length === items.length && new Set(metadata.items.map(i => i.itemId)).size === items.length, 'item coverage');
  for (const [itemIndex, item] of items.entries()) {
    const record = metadata.items[itemIndex];
    if (!record) continue;
    const source = item.en;
    check(record.itemId === item.id && record.sourceText === source && record.sourceHash === sha(source), `${item.id}: source authority`);
    check(record.leadingSeparator + record.sentences.map(s => s.sourceText + s.separatorAfter).join('') === source, `${item.id}: item reconstruction`);
    let charCursor = record.leadingSeparator.length;
    for (const [index, s] of record.sentences.entries()) {
      const label = `${item.id}/${index}`;
      check(!('variants' in s) && !('tierRules' in metadata), `${label}: legacy authority`);
      check(s.sentenceIndex === index && s.charStart === charCursor && s.charEnd === s.charStart + s.sourceText.length, `${label}: sentence span`);
      check(source.slice(s.charStart, s.charEnd) === s.sourceText, `${label}: sentence source`);
      charCursor = s.charEnd + s.separatorAfter.length;
      const p = s.partition;
      check(validateCanonicalVariant(p, s.sourceText), `${label}: canonical partition`);
      check(p.chunks.length <= 13, `${label}: tile exception required`);
      check(s.tokens.every((t, i) => t.i === i && source.slice(t.start, t.end) === t.text && (t.head === null || Number.isInteger(t.head) && t.head >= 0 && t.head < s.tokens.length)), `${label}: tokens`);
      let tokenCursor = 0; let chunkChar = s.charStart;
      for (const [n, c] of p.chunks.entries()) {
        check(c.id === `${item.id}:s${index}:c${n}` && c.tokenStart === tokenCursor && c.tokenEnd > tokenCursor, `${label}: ID/token coverage`);
        check(c.charStart === chunkChar && c.charStart === s.tokens[c.tokenStart]?.start && c.charEnd === s.tokens[c.tokenEnd - 1]?.end && source.slice(c.charStart, c.charEnd) === c.sourceText, `${label}: chunk span`);
        check(c.learningText === expectedLearning(source, c.charStart, c.charEnd) && !!c.learningText, `${label}: learning surface`);
        let memberCursor = c.tokenStart;
        for (const m of c.syntax.members) for (const [a, b] of m.tokenRanges) {
          check(a === memberCursor && b > a && b <= c.tokenEnd && s.tokens[m.headToken] && s.syntax.clauses.some(cl => cl.id === m.clauseId), `${label}: structural ownership`);
          memberCursor = b;
        }
        check(memberCursor === c.tokenEnd, `${label}: owner coverage`);
        tokenCursor = c.tokenEnd; chunkChar = c.charEnd + c.separatorAfter.length;
      }
      check(tokenCursor === s.tokens.length && chunkChar === s.charEnd, `${label}: partition coverage`);
      for (const cl of s.syntax.clauses) check(s.tokens[cl.headToken] && (cl.parentId === null || cl.parentId !== cl.id && s.syntax.clauses.some(v => v.id === cl.parentId)), `${label}: clause ownership`);
      for (const construction of s.syntax.constructions) {
        if (construction.hard) check(p.chunks.some(c => construction.tokenRanges.every(([a, b]) => c.tokenStart <= a && a < b && b <= c.tokenEnd)), `${label}: protected construction ${construction.id}`);
      }
      // Independent orthographic gate: no apostrophe/hyphen/number unit may cross a tile edge.
      for (const m of s.sourceText.matchAll(/[\p{L}\p{N}]+(?:[-'’/][\p{L}\p{N}]+)+|(?:\$)?\d+(?:[,:.]\d+)*(?:%)?/gu)) {
        const a = s.charStart + m.index; const b = a + m[0].length;
        check(!p.chunks.some(c => c.charStart > a && c.charStart < b || c.charEnd > a && c.charEnd < b), `${label}: lexical split`);
      }
      if (!s.fixedContext) {
        const state = createPuzzleState(p, { random: () => 0 });
        check(!!state, `${label}: no wrong visible order`);
        if (state) {
          check(!answerIsCorrect({ ...state, bank: [], answer: state.bank }), `${label}: shuffle accepted`);
          check(answerIsCorrect({ ...state, bank: [], answer: p.canonicalOrder }), `${label}: canonical grading`);
          for (const text of new Set(p.chunks.map(c => c.learningText))) {
            const ids = p.chunks.filter(c => c.learningText === text).map(c => c.id).reverse();
            let cursor = 0;
            const swapped = p.canonicalOrder.map(id => state.tileById.get(id).learningText === text ? ids[cursor++] : id);
            check(answerIsCorrect({ ...state, bank: [], answer: swapped }), `${label}: duplicate equivalence`);
          }
        }
      }
      check(p.chunks.map(c => c.learningText).every(t => typeof t === 'string' && t.trim() === t), `${label}: ASR direct reuse`);
    }
    check(charCursor === source.length, `${item.id}: source coverage`);
  }
  return errors;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateMetadata(read('data/items.json'), read('data/reorder-v1.json'));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Shared authority: full source, token/span, structural, lexical, surface and grading gates PASS');
}
