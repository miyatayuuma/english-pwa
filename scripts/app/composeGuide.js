export function createComposeGuide({
  composeGuideEl,
  composeTokensEl,
  composeNoteEl,
  defaultNote = '',
  isComposeMode = () => false,
  toks,
  shuffledCopy
} = {}) {
  const nodes = [];
  let active = false;

  const clearTokens = () => {
    nodes.length = 0;
    if (composeTokensEl) {
      composeTokensEl.innerHTML = '';
    }
  };

  const hideGuide = () => {
    if (composeGuideEl) {
      composeGuideEl.classList.remove('show');
      composeGuideEl.setAttribute('aria-hidden', 'true');
    }
    if (composeNoteEl) {
      composeNoteEl.textContent = defaultNote || '';
    }
  };

  const reset = () => {
    active = false;
    clearTokens();
    hideGuide();
  };

  const parseChunkSpecs = (raw) => {
    if (!raw) return [];
    let source = raw;
    if (typeof source === 'string') {
      const trimmed = source.trim();
      if (!trimmed) {
        return [];
      }
      try {
        source = JSON.parse(trimmed);
      } catch (_err) {
        return [];
      }
    }
    if (!Array.isArray(source)) return [];
    const specs = [];
    for (const entry of source) {
      let text = '';
      if (typeof entry === 'string') {
        text = entry;
      } else if (Array.isArray(entry)) {
        text = entry.filter(Boolean).join(' ');
      } else if (entry && typeof entry === 'object') {
        if (Array.isArray(entry.tokens)) {
          text = entry.tokens.filter(Boolean).join(' ');
        } else if (typeof entry.text === 'string') {
          text = entry.text;
        }
      }
      text = String(text || '').trim();
      if (!text) continue;
      const tokens = typeof toks === 'function' ? toks(text) : [];
      if (tokens.length) {
        specs.push({ text, tokens });
      }
    }
    specs.sort((a, b) => b.tokens.length - a.tokens.length);
    return specs;
  };

  const getItemChunkSpecs = (item) => {
    if (!item) return [];
    if (Array.isArray(item._chunkSpecs)) return item._chunkSpecs;
    const specs = parseChunkSpecs(item.chunks_json || item.chunks || '[]');
    item._chunkSpecs = specs;
    return specs;
  };

  const extractWordUnits = (text) => {
    if (!text || typeof toks !== 'function') return [];
    const units = [];
    const re = /[\p{L}\p{N}'-]+/gu;
    let m;
    while ((m = re.exec(text))) {
      const raw = m[0];
      const tokens = toks(raw);
      if (!tokens.length) continue;
      units.push({ text: raw, tokens });
    }
    return units;
  };

  const buildComposeChunks = (item) => {
    if (!item) return [];
    const words = extractWordUnits(item.en || '');
    if (!words.length) return [];
    const chunkSpecs = getItemChunkSpecs(item);
    const result = [];
    let i = 0;
    while (i < words.length) {
      let matched = null;
      if (chunkSpecs.length) {
        for (const spec of chunkSpecs) {
          const needed = spec.tokens.length;
          if (!needed) continue;
          let collected = [];
          let wordCount = 0;
          let j = i;
          while (j < words.length && collected.length < needed) {
            collected = collected.concat(words[j].tokens);
            wordCount += 1;
            j += 1;
          }
          if (collected.length < needed) continue;
          let ok = true;
          for (let k = 0; k < needed; k += 1) {
            if (collected[k] !== spec.tokens[k]) {
              ok = false;
              break;
            }
          }
          if (ok) {
            matched = {
              display: words.slice(i, i + wordCount).map((w) => w.text).join(' '),
              tokens: spec.tokens.slice(),
              wordCount
            };
            break;
          }
        }
      }
      if (matched) {
        result.push({ display: matched.display, tokens: matched.tokens });
        i += matched.wordCount;
      } else {
        const word = words[i];
        result.push({ display: word.text, tokens: word.tokens.slice() });
        i += 1;
      }
    }
    return result;
  };

  const setup = (item) => {
    if (!composeGuideEl || !composeTokensEl) {
      nodes.length = 0;
      active = false;
      return;
    }
    if (!isComposeMode() || !item) {
      reset();
      return;
    }
    const chunks = buildComposeChunks(item);
    if (!chunks.length) {
      reset();
      return;
    }
    active = true;
    clearTokens();
    const list = typeof shuffledCopy === 'function' ? shuffledCopy(chunks) : chunks.slice();
    for (const chunk of list) {
      const tokenEl = document.createElement('span');
      tokenEl.className = 'compose-token';
      tokenEl.setAttribute('role', 'listitem');
      tokenEl.textContent = chunk.display;
      composeTokensEl.appendChild(tokenEl);
      nodes.push({ el: tokenEl, tokens: Array.isArray(chunk.tokens) ? chunk.tokens.slice() : [] });
    }
    if (composeNoteEl) {
      composeNoteEl.textContent = `シャッフルされた ${chunks.length} 個の語句を参考に、正しい語順を意識して発話しましょう。`;
    }
    composeGuideEl.classList.add('show');
    composeGuideEl.setAttribute('aria-hidden', 'false');
  };

  const getNodes = () => nodes;

  const isActive = () => active;

  return {
    reset,
    setup,
    getNodes,
    isActive
  };
}
