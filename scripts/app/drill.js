const EMPTY_STATE = {
  term: '',
  phonetic: '',
  definitions: [],
  source: 'empty',
};

function safeDocument(root) {
  if (root && root.ownerDocument) return root.ownerDocument;
  if (typeof document !== 'undefined') return document;
  return null;
}

function extractLookupTerms(text) {
  const results = [];
  if (!text) return results;
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return results;
  results.push(normalized);
  const tokens = normalized.match(/[\p{L}\p{N}'-]+/gu) || [];
  const seen = new Set();
  for (const token of tokens) {
    const t = token.toLowerCase();
    if (!seen.has(t)) {
      seen.add(t);
      results.push(t);
    }
  }
  return results;
}

function formatDefinitions(definitions) {
  if (!Array.isArray(definitions) || !definitions.length) return [];
  return definitions
    .map((def) => (typeof def === 'string' ? def.trim() : ''))
    .filter(Boolean)
    .slice(0, 5);
}

function createClassList(target) {
  const classSet = new Set();
  return {
    add: (...tokens) => {
      tokens.forEach((token) => {
        if (typeof token === 'string' && token) {
          classSet.add(token);
        }
      });
      target.className = Array.from(classSet).join(' ');
    },
    remove: (...tokens) => {
      tokens.forEach((token) => classSet.delete(token));
      target.className = Array.from(classSet).join(' ');
    },
    toggle: (token, force) => {
      if (typeof token !== 'string' || !token) return;
      const exists = classSet.has(token);
      if (force === true || (!exists && force !== false)) {
        classSet.add(token);
      } else if (force === false || exists) {
        classSet.delete(token);
      }
      target.className = Array.from(classSet).join(' ');
    },
    contains: (token) => classSet.has(token),
  };
}

export function createDrillPanel({
  root,
  dictionaryClient,
  speakFallback,
} = {}) {
  if (!root) {
    return {
      loadItem: async () => {},
      hide: () => {},
      handleResult: () => {},
      getDebugState: () => ({ ...EMPTY_STATE, feedback: '', status: 'unavailable' }),
    };
  }

  const doc = safeDocument(root);
  if (!root.classList) {
    root.classList = createClassList(root);
  }
  root.classList.add('drill-panel');
  root.hidden = true;
  root.setAttribute?.('aria-hidden', 'true');

  const header = doc ? doc.createElement('div') : { className: '', textContent: '' };
  header.className = 'drill-header';
  const title = doc ? doc.createElement('h3') : { textContent: '' };
  title.textContent = 'Drill モード';
  header.appendChild?.(title);

  const wordEl = doc ? doc.createElement('div') : { textContent: '' };
  wordEl.className = 'drill-term';
  const phoneticEl = doc ? doc.createElement('div') : { textContent: '' };
  phoneticEl.className = 'drill-phonetic';
  const defsContainer = doc ? doc.createElement('div') : { appendChild: () => {}, innerHTML: '', className: '' };
  defsContainer.className = 'drill-definitions';
  const defsList = doc ? doc.createElement('ol') : { children: [], appendChild: () => {}, innerHTML: '' };
  defsList.className = 'drill-definition-list';
  defsContainer.appendChild?.(defsList);

  const controls = doc ? doc.createElement('div') : { appendChild: () => {}, className: '' };
  controls.className = 'drill-controls';
  const playBtn = doc ? doc.createElement('button') : { disabled: true, addEventListener: () => {} };
  playBtn.type = 'button';
  playBtn.className = 'btn drill-play';
  playBtn.textContent = '発音を再生';
  playBtn.disabled = true;
  controls.appendChild?.(playBtn);

  const statusEl = doc ? doc.createElement('div') : { textContent: '' };
  statusEl.className = 'drill-status muted';
  const feedbackEl = doc ? doc.createElement('div') : { textContent: '' };
  feedbackEl.className = 'drill-feedback';

  root.appendChild?.(header);
  root.appendChild?.(wordEl);
  root.appendChild?.(phoneticEl);
  root.appendChild?.(defsContainer);
  root.appendChild?.(controls);
  root.appendChild?.(statusEl);
  root.appendChild?.(feedbackEl);

  const audio = typeof Audio === 'function' ? new Audio() : null;
  if (audio) {
    audio.preload = 'none';
  }

  let currentEntry = null;
  let currentItemId = '';
  let lookupToken = 0;

  function setStatus(text) {
    if (statusEl) {
      statusEl.textContent = text || '';
    }
  }

  function clearDefinitions() {
    if (!defsList) return;
    if (typeof defsList.innerHTML === 'string') {
      defsList.innerHTML = '';
    } else if (Array.isArray(defsList.children)) {
      defsList.children.length = 0;
    }
    while (defsList.firstChild) {
      defsList.removeChild(defsList.firstChild);
    }
  }

  function renderDefinitions(definitions) {
    clearDefinitions();
    const list = formatDefinitions(definitions);
    if (!list.length) {
      return false;
    }
    for (const def of list) {
      const li = doc ? doc.createElement('li') : { textContent: '' };
      li.textContent = def;
      defsList.appendChild?.(li);
    }
    return true;
  }

  function setPlayAvailability(available) {
    if (playBtn) {
      playBtn.disabled = !available;
      playBtn.setAttribute?.('aria-disabled', available ? 'false' : 'true');
    }
  }

  function hidePanel() {
    root.hidden = true;
    root.setAttribute?.('aria-hidden', 'true');
    currentEntry = null;
    currentItemId = '';
    setStatus('');
    if (feedbackEl) {
      feedbackEl.textContent = '';
    }
  }

  async function playPronunciation() {
    if (!currentEntry) {
      setStatus('辞書データがありません');
      return;
    }
    setStatus('');
    const audioUrls = Array.isArray(currentEntry.audioUrls) ? currentEntry.audioUrls : [];
    if (audio && audioUrls.length) {
      for (const url of audioUrls) {
        if (!url) continue;
        try {
          audio.src = url;
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.then === 'function') {
            await playPromise;
          }
          return;
        } catch (err) {
          console.warn('drill audio playback failed', err);
        }
      }
    }
    if (typeof speakFallback === 'function') {
      const fallbackResult = await speakFallback({ term: currentEntry.term || wordEl.textContent || '' });
      if (fallbackResult) return;
    }
    setStatus('発音音声を再生できませんでした');
  }

  playBtn?.addEventListener?.('click', () => {
    playPronunciation().catch((err) => {
      console.warn('drill playPronunciation error', err);
      setStatus('発音音声を再生できませんでした');
    });
  });

  function applyEntry(entry, item) {
    currentEntry = entry && entry.term ? entry : null;
    currentItemId = item?.id || '';
    if (wordEl) {
      wordEl.textContent = item?.en || entry?.term || '';
    }
    if (phoneticEl) {
      phoneticEl.textContent = entry?.phonetic || '—';
    }
    const hasDefs = renderDefinitions(entry?.definitions || []);
    if (!hasDefs) {
      const li = doc ? doc.createElement('li') : { textContent: '' };
      li.textContent = '定義情報が見つかりません。';
      defsList.appendChild?.(li);
    }
    const fromCache = entry?.source === 'cache';
    if (entry?.error) {
      setStatus('辞書データをキャッシュから表示しています');
    } else if (fromCache) {
      setStatus('キャッシュ済みの辞書データを表示しています');
    } else {
      setStatus('');
    }
    setPlayAvailability(!!(currentEntry && ((currentEntry.audioUrls && currentEntry.audioUrls.length) || typeof speakFallback === 'function')));
  }

  async function loadItem(item) {
    lookupToken += 1;
    const token = lookupToken;
    if (!item) {
      hidePanel();
      return;
    }
    root.hidden = false;
    root.setAttribute?.('aria-hidden', 'false');
    currentItemId = item.id || '';
    if (wordEl) {
      wordEl.textContent = item.en || '';
    }
    if (phoneticEl) {
      phoneticEl.textContent = '';
    }
    clearDefinitions();
    setStatus(dictionaryClient ? '辞書データを取得しています…' : '辞書データを利用できません');
    if (feedbackEl) {
      feedbackEl.textContent = '';
    }
    currentEntry = null;
    setPlayAvailability(false);

    if (!dictionaryClient || typeof dictionaryClient.lookup !== 'function') {
      return;
    }

    const terms = extractLookupTerms(item.en);
    const [primary, ...fallbacks] = terms;
    if (!primary) {
      setStatus('辞書データを利用できません');
      return;
    }
    try {
      const entry = await dictionaryClient.lookup(primary, { fallbackTerms: fallbacks });
      if (token !== lookupToken) return;
      applyEntry(entry || EMPTY_STATE, item);
    } catch (err) {
      console.warn('dictionary lookup failed', err);
      if (token !== lookupToken) return;
      setStatus('辞書データを取得できませんでした');
      currentEntry = null;
      setPlayAvailability(typeof speakFallback === 'function');
    }
  }

  function handleResult({ pass, missingTokens } = {}) {
    if (!feedbackEl) return;
    if (!currentEntry) {
      feedbackEl.textContent = pass ? 'Good job!' : '辞書データなしでのチャレンジでした。もう一度試しましょう。';
      return;
    }
    if (pass) {
      feedbackEl.textContent = 'Great! 次の語彙へ進みましょう。';
      return;
    }
    const missing = Array.isArray(missingTokens) ? missingTokens.filter(Boolean) : [];
    const parts = [];
    if (missing.length) {
      parts.push(`欠落: ${missing.join(', ')}`);
    }
    if (currentEntry.phonetic) {
      parts.push(`音標 ${currentEntry.phonetic}`);
    }
    if (Array.isArray(currentEntry.definitions) && currentEntry.definitions.length) {
      parts.push(`意味: ${currentEntry.definitions[0]}`);
    }
    if (!parts.length) {
      parts.push('うまくいきませんでした。もう一度試しましょう。');
    }
    feedbackEl.textContent = parts.join(' / ');
  }

  function getDebugState() {
    return {
      term: wordEl?.textContent || '',
      phonetic: phoneticEl?.textContent || '',
      definitions: Array.from(defsList?.children || []).map((child) => child.textContent || ''),
      status: statusEl?.textContent || '',
      feedback: feedbackEl?.textContent || '',
      hasAudio: !!(currentEntry && currentEntry.audioUrls && currentEntry.audioUrls.length),
    };
  }

  return {
    loadItem,
    hide: hidePanel,
    handleResult,
    getDebugState,
  };
}
