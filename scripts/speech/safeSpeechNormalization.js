import { canonicalizeToken } from '../utils/text.js';

const APOSTROPHE_VARIANTS = /[‘’‛ʼ＇]/gu;
const DASH_VARIANTS = /[‐‑‒–—−﹘﹣－]/gu;
// Hyphens are orthographic word boundaries for speech matching. Splitting them
// here makes `up-to-date` and `up to date` share ordered units while retaining
// original source spans for highlighting. Apostrophes remain inside a token.
const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;

function appendMappedSlice(textParts, spanParts, text, spans, start, end) {
  textParts.push(text.slice(start, end));
  for (let index = start; index < end; index += 1) spanParts.push(spans[index]);
}

function replaceMapped(text, spans, pattern, replacement) {
  const textParts = [];
  const spanParts = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    appendMappedSlice(textParts, spanParts, text, spans, cursor, start);
    const rangeStart = spans[start]?.[0] ?? start;
    const rangeEnd = spans[end - 1]?.[1] ?? end;
    const value = typeof replacement === 'function' ? replacement(match) : replacement;
    textParts.push(value);
    for (let index = 0; index < value.length; index += 1) spanParts.push([rangeStart, rangeEnd]);
    cursor = end;
  }
  appendMappedSlice(textParts, spanParts, text, spans, cursor, text.length);
  return { text: textParts.join(''), spans: spanParts };
}

function prepareSpeechText(value) {
  const source = String(value ?? '');
  let text = '';
  let spans = [];
  for (let index = 0; index < source.length;) {
    const codePoint = source.codePointAt(index);
    const end = index + (codePoint > 0xffff ? 2 : 1);
    const normalized = source.slice(index, end).normalize('NFKC');
    text += normalized;
    for (let offset = 0; offset < normalized.length; offset += 1) spans.push([index, end]);
    index = end;
  }

  ({ text, spans } = replaceMapped(text, spans, APOSTROPHE_VARIANTS, "'"));
  ({ text, spans } = replaceMapped(text, spans, DASH_VARIANTS, '-'));
  ({ text, spans } = replaceMapped(text, spans, /℃/gu, ' degree celsius '));
  ({ text, spans } = replaceMapped(text, spans, /°\s*c/giu, ' degree celsius '));
  ({ text, spans } = replaceMapped(text, spans, /\$(\s*\d+(?:\.\d+)?)/gu,
    match => ` ${match[1].replace(/\s+/gu, '')} usd `));
  ({ text, spans } = replaceMapped(text, spans, /\$/gu, ' usd '));

  const lowered = [];
  const loweredSpans = [];
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    const end = index + (codePoint > 0xffff ? 2 : 1);
    const value = text.slice(index, end).toLocaleLowerCase('en-US');
    lowered.push(value);
    for (let offset = 0; offset < value.length; offset += 1) loweredSpans.push(spans[index]);
    index = end;
  }
  return { text: lowered.join(''), spans: loweredSpans };
}

// This normalization only canonicalizes representation and existing numeric
// units. It preserves spaces, apostrophes, and hyphenated word boundaries.
export function safeSpeechTokens(value) {
  const { text, spans } = prepareSpeechText(value);
  const tokens = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const surface = match[0];
    const normalized = canonicalizeToken(surface);
    if (!normalized) continue;
    const start = spans[match.index]?.[0] ?? match.index;
    const end = spans[match.index + surface.length - 1]?.[1] ?? match.index + surface.length;
    tokens.push({
      value: normalized,
      raw: String(value ?? '').slice(start, end),
      start,
      end,
    });
  }
  return tokens;
}

export function hasSafeSpeechToken(value) {
  return safeSpeechTokens(value).length > 0;
}
