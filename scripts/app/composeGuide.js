export function createComposeGuide({
  composeGuideEl,
  composeTokensEl,
  composeNoteEl,
  defaultNote = '',
  getTaskType = () => 'read',
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

  const getPartialHints = (item) => {
    const hints = [];
    if (item && typeof item.prompt_ja === 'string' && item.prompt_ja.trim()) {
      hints.push(`和文プロンプト: ${item.prompt_ja.trim()}`);
    }
    if (item && Array.isArray(item.paraphrases) && item.paraphrases.length) {
      hints.push(`言い換え: ${item.paraphrases.slice(0, 2).join(' / ')}`);
    }
    if (item && typeof item.focus_grammar === 'string' && item.focus_grammar.trim()) {
      hints.push(`文法フォーカス: ${item.focus_grammar.trim()}`);
    }
    return hints;
  };

  const setup = (item) => {
    if (!composeGuideEl || !composeTokensEl) {
      nodes.length = 0;
      active = false;
      return;
    }
    const taskType = typeof getTaskType === 'function' ? getTaskType(item) : 'read';
    const isComposeTask = taskType === 'compose';
    const isGenerateTask = taskType === 'generate';
    if ((!isComposeTask && !isGenerateTask) || !item) {
      reset();
      return;
    }

    const chunks = buildComposeChunks(item);
    const partialHints = getPartialHints(item);
    const wordBankEnabled = isComposeTask || !!item?.generate_word_bank;
    if (!chunks.length && wordBankEnabled) {
      reset();
      return;
    }

    active = true;
    clearTokens();
    if (wordBankEnabled) {
      const list = typeof shuffledCopy === 'function' ? shuffledCopy(chunks) : chunks.slice();
      for (const chunk of list) {
        const tokenEl = document.createElement('span');
        tokenEl.className = 'compose-token';
        tokenEl.setAttribute('role', 'listitem');
        tokenEl.textContent = chunk.display;
        composeTokensEl.appendChild(tokenEl);
        nodes.push({ el: tokenEl, tokens: Array.isArray(chunk.tokens) ? chunk.tokens.slice() : [] });
      }
    }

    if (!wordBankEnabled) {
      const ghost = document.createElement('span');
      ghost.className = 'compose-token';
      ghost.setAttribute('role', 'listitem');
      ghost.textContent = '語群なしモード';
      composeTokensEl.appendChild(ghost);
    }

    if (composeNoteEl) {
      if (isComposeTask) {
        composeNoteEl.textContent = `整序英作文: シャッフルされた ${chunks.length} 個の語句を使って語順を整えましょう。`;
      } else {
        const baseNote = wordBankEnabled
          ? `和文→英文生成: 語群ありで英作文を組み立てましょう。`
          : '和文→英文生成: 語群なし。自力で英文を組み立てましょう。';
        composeNoteEl.textContent = partialHints.length ? `${baseNote} / ${partialHints.join(' / ')}` : baseNote;
      }
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
