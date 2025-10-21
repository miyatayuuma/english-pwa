const CONTRACTION_PATTERNS = [
  { seq: ['i', 'm'], out: 'im' },
  { seq: ['i', 'd'], out: 'id' },
  { seq: ['i', 'll'], out: 'ill' },
  { seq: ['i', 've'], out: 'ive' },
  { seq: ['you', 're'], out: 'youre' },
  { seq: ['you', 've'], out: 'youve' },
  { seq: ['you', 'll'], out: 'youll' },
  { seq: ['you', 'd'], out: 'youd' },
  { seq: ['he', 's'], out: 'hes' },
  { seq: ['she', 's'], out: 'shes' },
  { seq: ['it', 's'], out: 'its' },
  { seq: ['we', 're'], out: 'were' },
  { seq: ['we', 've'], out: 'weve' },
  { seq: ['we', 'll'], out: 'well' },
  { seq: ['we', 'd'], out: 'wed' },
  { seq: ['they', 're'], out: 'theyre' },
  { seq: ['they', 've'], out: 'theyve' },
  { seq: ['they', 'll'], out: 'theyll' },
  { seq: ['they', 'd'], out: 'theyd' },
  { seq: ['that', 's'], out: 'thats' },
  { seq: ['there', 's'], out: 'theres' },
  { seq: ['here', 's'], out: 'heres' },
  { seq: ['who', 's'], out: 'whos' },
  { seq: ['what', 's'], out: 'whats' },
  { seq: ['where', 's'], out: 'wheres' },
  { seq: ['when', 's'], out: 'whens' },
  { seq: ['why', 's'], out: 'whys' },
  { seq: ['how', 's'], out: 'hows' },
  { seq: ['let', 's'], out: 'lets' }
];

const NUMBER_WORD_MAP = new Map(Object.entries({
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
  thousand: '1000',
  million: '1000000',
  billion: '1000000000'
}));

const CURRENCY_MAP = new Map([
  ['dollar', 'usd'],
  ['dollars', 'usd'],
  ['usd', 'usd']
]);

const UNIT_MAP = new Map([
  ['degrees', 'degree'],
  ['degree', 'degree'],
  ['celsius', 'celsius']
]);

export function mergeContractions(tokens) {
  if (!tokens.length) return tokens;
  const out = [];
  for (let i = 0; i < tokens.length;) {
    let matched = false;
    for (const { seq, out: outToken } of CONTRACTION_PATTERNS) {
      if (i + seq.length > tokens.length) continue;
      let ok = true;
      for (let j = 0; j < seq.length; j++) {
        if (tokens[i + j] !== seq[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        out.push(outToken);
        i += seq.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    out.push(tokens[i]);
    i++;
  }
  return out;
}

export function canonicalizeToken(token) {
  if (!token) return '';
  const digits = token.replace(/[,]/g, '');
  if (/^[+-]?\d+(?:\.\d+)?$/.test(digits)) {
    return digits.replace(/^\+/, '');
  }
  const num = NUMBER_WORD_MAP.get(token);
  if (num) return num;
  const unit = UNIT_MAP.get(token);
  if (unit) return unit;
  const curr = CURRENCY_MAP.get(token);
  if (curr) return curr;
  return token;
}

export function canonicalTokens(input) {
  if (!input) return [];
  let text = (input || '').toLowerCase().normalize('NFKC');
  text = text.replace(/℃/g, ' degree celsius ');
  text = text.replace(/°\s*c/g, ' degree celsius ');
  text = text.replace(/\$(\s*\d+(?:\.\d+)?)/g, (_, num) => ` ${num.replace(/\s+/g, '')} usd `);
  text = text.replace(/\$/g, ' usd ');
  text = text.replace(/(?<=[\p{L}\p{N}])['’](?=[\p{L}\p{N}])/gu, '');
  text = text.replace(/[-‐‑‒–—−﹘﹣－]/gu, ' ');
  text = text.replace(/[\p{P}\p{S}]/gu, ' ');
  const raw = text.split(/\s+/).filter(Boolean);
  if (!raw.length) return [];
  const merged = mergeContractions(raw);
  return merged.map(canonicalizeToken).filter(Boolean);
}

export const toks = (input) => canonicalTokens(input);

export const norm = (input) => canonicalTokens(input).join(' ');

export function dedupeRuns(arr) {
  const out = [];
  for (const w of arr) {
    if (out.length && out[out.length - 1] === w) continue;
    out.push(w);
  }
  return out;
}

export function approxWithin1(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  diff += (la - i) + (lb - j);
  return diff <= 1;
}

export function appendStableFinal(stable, fragment) {
  const A = canonicalTokens(stable);
  const B = canonicalTokens(fragment);
  if (!B.length) return dedupeRuns(A).join(' ');
  if (!A.length) return dedupeRuns(B).join(' ');

  const strA = A.join(' ');
  const strB = B.join(' ');

  if (strB.includes(strA)) {
    return dedupeRuns(B).join(' ');
  }
  if (strA.includes(strB)) {
    return dedupeRuns(A).join(' ');
  }

  let overlap = 0;
  const maxOverlap = Math.min(A.length, B.length);
  outer: for (let k = maxOverlap; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      if (!approxWithin1(A[A.length - k + i], B[i])) continue outer;
    }
    overlap = k;
    break;
  }
  if (overlap > 0) {
    return dedupeRuns(A.concat(B.slice(overlap))).join(' ');
  }

  return dedupeRuns((B.length >= A.length ? B : A)).join(' ');
}

export function spanify(text) {
  const parts = (text || '').split(/(\s+)/);
  return parts
    .map((part) => {
      if (!part) return '';
      if (/^[\s]+$/.test(part)) {
        return part
          .replace(/\r?\n/g, '<br>')
          .replace(/[^\S\r\n]+/g, ' ');
      }
      const tokens = part.match(/[\p{L}\p{N}'-]+|./gu) || [];
      return tokens
        .map((tok) => {
          if (/^[\p{L}\p{N}'-]+$/u.test(tok) && /[\p{L}\p{N}]/u.test(tok)) {
            const clean = tok.replace(/[^\p{L}\p{N}'-]/gu, '');
            return `<span class="tok" data-w="${clean}">${tok}</span>`;
          }
          return tok;
        })
        .join('');
    })
    .join('');
}
