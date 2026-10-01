import {
  REORDER_SCHEMA_VERSION,
  createPuzzleState,
  moveTile,
  reorderAnswerTile,
  answerIsComplete,
  answerIsCorrect,
  recordWrongAttempt,
  markSentenceComplete,
  restorePuzzle,
  selectReorderVariant,
} from '../reorder/reorderCore.js';
import { reduceReorderResult } from './reorderGrading.js';

let metadataPromise = null;

async function loadReorderMetadata() {
  if (!metadataPromise) {
    const metadataUrl = new URL('../../data/reorder-v1.json', import.meta.url);
    metadataPromise = fetch(metadataUrl, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`reorder metadata unavailable (${response.status})`);
      const data = await response.json();
      if (data?.schemaVersion !== REORDER_SCHEMA_VERSION || !Array.isArray(data?.items)) {
        throw new Error('reorder metadata schema mismatch');
      }
      return { data, byId: new Map(data.items.map((item) => [String(item.itemId), item])) };
    }).catch((error) => {
      metadataPromise = null;
      throw error;
    });
  }
  return metadataPromise;
}

async function sourceHash(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === 'undefined') return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(String(value ?? '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function setVisible(node, visible) {
  if (!node) return;
  node.hidden = !visible;
}

function button(label, className, action) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.dataset.action = action;
  node.textContent = label;
  return node;
}

function readableSentence(sentence) {
  return (sentence?.text ?? '').replace(/\s+/gu, ' ').trim();
}

export function createReorderGuide({
  composeGuideEl,
  composeTokensEl,
  composeAnswerEl,
  composeContextEl,
  composeFeedbackEl,
  composeControlsEl,
  composeNoteEl,
  onComplete = () => {},
  onStageChange = () => {},
  onNext = () => {},
} = {}) {
  let active = false;
  let complete = false;
  let disabledReason = '';
  let puzzleRows = [];
  let puzzleIndex = 0;
  let puzzleState = null;
  let history = [];
  let initialBank = [];
  let pointer = null;
  let suppressClickId = '';
  let sentenceIsAssisted = false;
  let fullUtteranceText = '';
  let fixedContextLines = [];
  let noteDefault = composeNoteEl?.textContent ?? '';

  const currentRow = () => puzzleRows[puzzleIndex] ?? null;
  const feedback = (text) => {
    if (composeFeedbackEl) composeFeedbackEl.textContent = text;
  };
  const note = (text) => {
    if (composeNoteEl) composeNoteEl.textContent = text;
  };
  const clear = () => {
    puzzleRows = [];
    puzzleIndex = 0;
    puzzleState = null;
    history = [];
    initialBank = [];
    fixedContextLines = [];
    pointer = null;
    suppressClickId = '';
    fullUtteranceText = '';
    complete = false;
    active = false;
    if (composeTokensEl) composeTokensEl.replaceChildren();
    if (composeAnswerEl) composeAnswerEl.replaceChildren();
    if (composeContextEl) composeContextEl.replaceChildren();
    if (composeFeedbackEl) composeFeedbackEl.textContent = '';
    if (composeControlsEl) composeControlsEl.replaceChildren();
    if (composeGuideEl) {
      composeGuideEl.classList.remove('show', 'is-complete');
      composeGuideEl.setAttribute('aria-hidden', 'true');
      delete composeGuideEl.dataset.tier;
    }
    note(noteDefault);
    onStageChange({ active: false, complete: false, disabledReason: '' });
  };

  const createControls = () => {
    if (!composeControlsEl) return;
    composeControlsEl.replaceChildren(
      button('戻す', 'compose-control', 'undo'),
      button('最初から', 'compose-control', 'reset'),
      button('判定', 'compose-control compose-control--primary', 'check'),
    );
  };

  const snapshot = () => {
    if (!puzzleState) return;
    history.push({ bank: puzzleState.bank.slice(), answer: puzzleState.answer.slice() });
    if (history.length > 40) history.shift();
  };

  const getTile = (tileId) => currentRow()?.variant.tiles.find((tile) => tile.id === tileId) ?? null;

  const tileButton = (tileId, zone) => {
    const tile = getTile(tileId);
    if (!tile) return null;
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'compose-token';
    node.dataset.tileId = tile.id;
    node.dataset.zone = zone;
    node.textContent = tile.text;
    node.setAttribute('aria-label', zone === 'bank'
      ? `${tile.text}、未配置。EnterまたはSpaceで解答欄へ移動`
      : `${tile.text}、解答。EnterまたはSpaceでバンクへ戻す。矢印キーで並べ替え`);
    node.title = zone === 'answer' ? `${tile.text}。矢印キーで並べ替え` : `${tile.text}。EnterまたはSpaceで解答欄へ移動`;
    node.draggable = false;
    return node;
  };

  const renderSyntax = (row) => {
    if (!composeContextEl || !row) return;
    const preview = document.createElement('p');
    preview.className = 'compose-feedback__canonical';
    preview.textContent = `英文: ${readableSentence(row.sentence)}`;
    composeContextEl.replaceChildren(preview);
  };

  const render = ({ focusId = '', announcement = '' } = {}) => {
    if (!active || !puzzleState || !composeTokensEl || !composeAnswerEl) return;
    const row = currentRow();
    if (!row) return;
    composeTokensEl.replaceChildren(...puzzleState.bank.map((tileId) => tileButton(tileId, 'bank')).filter(Boolean));
    composeAnswerEl.replaceChildren(...puzzleState.answer.map((tileId) => tileButton(tileId, 'answer')).filter(Boolean));
    composeTokensEl.setAttribute('aria-label', 'まだ置いていない語句');
    composeAnswerEl.setAttribute('aria-label', '解答の語順。矢印キーで並べ替え');
    const check = composeControlsEl?.querySelector('[data-action="check"]');
    if (check) check.disabled = !answerIsComplete(puzzleState) || puzzleState.status !== 'playing';
    const undo = composeControlsEl?.querySelector('[data-action="undo"]');
    const reset = composeControlsEl?.querySelector('[data-action="reset"]');
    if (undo) undo.disabled = history.length === 0 || ['complete', 'assisted', 'revealed'].includes(puzzleState.status);
    if (reset) reset.disabled = ['complete', 'assisted', 'revealed'].includes(puzzleState.status);
    if (announcement) feedback(announcement);
    if (focusId) {
      [...composeGuideEl.querySelectorAll('[data-tile-id]')].find((node) => node.dataset.tileId === focusId)?.focus();
    }
  };

  const advanceSentence = () => {
    const row = currentRow();
    if (!row) return;
    if (!row.fixedContext) {
      const assisted = sentenceIsAssisted;
      puzzleState = markSentenceComplete(puzzleState, { assisted });
    }
    puzzleIndex += 1;
    history = [];
    puzzleState = null;
    if (puzzleIndex >= puzzleRows.length) {
      complete = true;
      active = false;
      composeGuideEl?.classList.add('is-complete');
      const result = reduceReorderResult(puzzleRows.filter((entry) => !entry.fixedContext).map((entry) => entry.result));
      if (composeTokensEl) composeTokensEl.replaceChildren();
      if (composeAnswerEl) composeAnswerEl.replaceChildren();
      if (composeControlsEl) composeControlsEl.replaceChildren(button('次へ', 'compose-control compose-control--primary', 'next'));
      if (composeContextEl) {
        const whole = document.createElement('p');
        whole.className = 'compose-feedback__canonical';
        whole.textContent = fullUtteranceText;
        composeContextEl.replaceChildren(whole);
      }
      note('');
      feedback({FIRST_TRY:'一発正解', RETRY_PASS:'自力で正解', FAILED:'正解を確認しました'}[result.grade]);
      onStageChange({ active: false, complete: true, disabledReason: '' });
      onComplete(result);
      return;
    }
    sentenceIsAssisted = false;
    beginPuzzle();
  };

  const finishCorrectly = () => {
    if (!puzzleState) return;
    puzzleState = markSentenceComplete(puzzleState);
    const row = currentRow();
    row.assisted = false;
    row.result = { wrongAttempts: puzzleState.attempts, revealed: false, completed: true };
    renderSyntax(row);
    if (composeControlsEl) {
      composeControlsEl.replaceChildren(button(puzzleIndex + 1 < puzzleRows.length ? '次の文へ' : '完了', 'compose-control compose-control--primary', 'advance'));
    }
    feedback('正解');
    note('');
  };

  const revealAssistedAnswer = () => {
    const row = currentRow();
    if (!row || !puzzleState) return;
    sentenceIsAssisted = true;
    row.assisted = true;
    row.result = { wrongAttempts: puzzleState.attempts, revealed: true, completed: true };
    puzzleState = {
      ...puzzleState,
      bank: [],
      answer: row.variant.canonicalOrder.slice(),
      status: 'revealed',
    };
    renderSyntax(row);
    render();
    if (composeControlsEl) {
      composeControlsEl.replaceChildren(button(puzzleIndex + 1 < puzzleRows.length ? '次の文へ' : '完了', 'compose-control compose-control--primary', 'advance'));
    }
    feedback('3回目の誤答のため、正しい語順を表示しました。');
    note('');
  };

  const checkAnswer = () => {
    if (puzzleState?.status !== 'playing' || !answerIsComplete(puzzleState)) return;
    if (answerIsCorrect(puzzleState)) {
      finishCorrectly();
      return;
    }
    puzzleState = recordWrongAttempt(puzzleState);
    if (puzzleState.attempts >= 3) {
      revealAssistedAnswer();
      return;
    }
    render({ announcement: 'もう一度' });
  };

  const beginPuzzle = () => {
    const row = currentRow();
    if (!row) return;
    if (row.fixedContext) {
      puzzleState = null;
      history = [];
      if (composeContextEl) {
        const context = document.createElement('p');
        context.className = 'compose-context-line';
        context.textContent = `固定文脈: ${readableSentence(row.sentence)}`;
        composeContextEl.replaceChildren(context);
      }
      if (composeTokensEl) composeTokensEl.replaceChildren();
      if (composeAnswerEl) composeAnswerEl.replaceChildren();
      if (composeControlsEl) composeControlsEl.replaceChildren(button('次へ', 'compose-control compose-control--primary', 'advance'));
      note(`Sentence ${puzzleIndex + 1}/${puzzleRows.length} · 固定文脈`);
      feedback('この短い断片は並べ替えず、文脈として確認してください。');
      return;
    }
    puzzleState = row.initialState;
    initialBank = puzzleState.bank.slice();
    history = [];
    if (composeContextEl) {
      const previous = puzzleRows.slice(0, puzzleIndex)
        .filter((entry) => !entry.fixedContext)
        .map((entry) => `完了: ${readableSentence(entry.sentence)}`);
      composeContextEl.replaceChildren();
      for (const text of [...fixedContextLines, ...previous]) {
        const line = document.createElement('p');
        line.className = 'compose-context-line';
        line.textContent = text;
        composeContextEl.appendChild(line);
      }
    }
    if (composeGuideEl) composeGuideEl.dataset.tier = row.variant.tier;
    if (composeControlsEl) createControls();
    note('');
    feedback('');
    render();
  };

  const move = (tileId, zone, index) => {
    if (!puzzleState || puzzleState.status !== 'playing') return;
    snapshot();
    puzzleState = moveTile(puzzleState, tileId, zone, index);
    feedback('');
    render({ focusId: tileId });

  };

  const restore = () => {
    if (!puzzleState || puzzleState.status !== 'playing') return;
    snapshot();
    puzzleState = restorePuzzle(puzzleState, initialBank);
    render({ announcement: '現在の文を最初の配置に戻しました。' });
  };

  const handleClick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'next') { onNext(); return; }
    if (action === 'check') { checkAnswer(); return; }
    if (action === 'advance') { advanceSentence(); return; }
    if (action === 'undo') {
      if (!history.length || !puzzleState || puzzleState.status !== 'playing') return;
      const prior = history.pop();
      puzzleState = { ...puzzleState, bank: prior.bank, answer: prior.answer };
      render({ announcement: '直前の操作を戻しました。' });
      return;
    }
    if (action === 'reset') { restore(); return; }
    const tile = event.target.closest('[data-tile-id]');
    if (!tile) return;
    if (suppressClickId) {
      const suppressed = suppressClickId === tile.dataset.tileId;
      suppressClickId = '';
      if (suppressed) return;
    }
    if (tile.dataset.zone === 'bank') move(tile.dataset.tileId, 'answer');
    else move(tile.dataset.tileId, 'bank');
  };

  const handleKeydown = (event) => {
    const tile = event.target.closest('[data-tile-id]');
    if (!tile || tile.dataset.zone !== 'answer' || !puzzleState) return;
    let delta = 0;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') delta = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') delta = 1;
    if (!delta) return;
    event.preventDefault();
    snapshot();
    puzzleState = reorderAnswerTile(puzzleState, tile.dataset.tileId, delta);
    feedback('');
    render({ focusId: tile.dataset.tileId });

  };

  const handlePointerDown = (event) => {
    const tile = event.target.closest('[data-tile-id]');
    if (!tile || !active || event.button !== 0) return;
    pointer = { id: tile.dataset.tileId, zone: tile.dataset.zone, x: event.clientX, y: event.clientY, dragging: false };
  };

  const handlePointerMove = (event) => {
    if (!pointer) return;
    const distance = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y);
    if (!pointer.dragging && distance < 9) return;
    pointer.dragging = true;
    event.preventDefault();
    composeGuideEl?.querySelector(`[data-tile-id="${pointer.id}"]`)?.classList.add('is-dragging');
  };

  const handlePointerUp = (event) => {
    if (!pointer) return;
    const drag = pointer;
    pointer = null;
    if (!drag.dragging) return;
    suppressClickId = drag.id;
    globalThis.setTimeout?.(() => {
      if (suppressClickId === drag.id) suppressClickId = '';
    }, 0);
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const targetTile = target?.closest('[data-tile-id]');
    const targetZone = targetTile?.dataset.zone ?? target?.closest('[data-drop-zone]')?.dataset.dropZone;
    if (!targetZone) { render({ announcement: '語句は解答欄か語句バンクへ移動できます。' }); return; }
    let insertIndex;
    if (targetTile?.dataset.tileId === drag.id && targetZone === 'answer') return;
    if (targetTile && targetZone === 'answer') {
      const rect = targetTile.getBoundingClientRect();
      insertIndex = [...composeAnswerEl.querySelectorAll('[data-tile-id]')].findIndex((node) => node.dataset.tileId === targetTile.dataset.tileId);
      if (event.clientX > rect.left + rect.width / 2) insertIndex += 1;
      if (drag.zone === 'answer') {
        const fromIndex = [...composeAnswerEl.querySelectorAll('[data-tile-id]')]
          .findIndex((node) => node.dataset.tileId === drag.id);
        if (fromIndex >= 0 && fromIndex < insertIndex) insertIndex -= 1;
      }
    }
    move(drag.id, targetZone, insertIndex);
  };

  composeGuideEl?.addEventListener('click', handleClick);
  composeGuideEl?.addEventListener('keydown', handleKeydown);
  composeGuideEl?.addEventListener('pointerdown', handlePointerDown);
  globalThis.addEventListener?.('pointermove', handlePointerMove, { passive: false });
  globalThis.addEventListener?.('pointerup', handlePointerUp);
  globalThis.addEventListener?.('pointercancel', handlePointerUp);

  async function setup(item, bestLevel = 0) {
    clear();
    disabledReason = '';
    const taskType = String(item?.taskType ?? '').toLowerCase();
    if (!['compose', 'generate'].includes(taskType) || !item) return { active: false, reason: '' };
    try {
      const { data, byId } = await loadReorderMetadata();
      if (data.schemaVersion !== REORDER_SCHEMA_VERSION) throw new Error('schema mismatch');
      const metadata = byId.get(String(item.id));
      const actualHash = await sourceHash(item.en);
      if (!metadata || !actualHash || metadata.sourceHash !== actualHash) throw new Error('source metadata mismatch');
      if (metadata.status === 'excluded' || metadata.sentences.some((sentence) => sentence.excludedReason)) {
        disabledReason = 'この文は安全な語句分割を作れないため、この項目をスキップしてください。';
        return { active: false, reason: disabledReason };
      }
      const staged = [];
      for (const sentence of metadata.sentences) {
        if (sentence.fixedContext) {
          staged.push({ sentence, fixedContext: true });
          continue;
        }
        const selected = selectReorderVariant(sentence, bestLevel);
        if (!selected) throw new Error('no usable variant');
        const state = createPuzzleState(selected.variant);
        if (!state) throw new Error('no safe wrong initial order');
        staged.push({ sentence, variant: selected.variant, tier: selected.tier, initialState: state });
      }
      const puzzleEntries = staged.filter((entry) => !entry.fixedContext);
      if (!puzzleEntries.length) {
        disabledReason = 'この項目には並べ替え可能な文がないため、この項目をスキップしてください。';
        return { active: false, reason: disabledReason };
      }
      // Keep context-only fragments in source order inside the sentence stage.
      puzzleRows = staged;
      fixedContextLines = staged
        .filter((entry) => entry.fixedContext)
        .map((entry) => `固定文脈: ${readableSentence(entry.sentence)}`);
      fullUtteranceText = String(item.en ?? '');
      if (composeGuideEl) {
        composeGuideEl.classList.add('show');
        composeGuideEl.setAttribute('aria-hidden', 'false');
      }
      active = true;
      complete = false;
      puzzleIndex = 0;
      sentenceIsAssisted = false;
      noteDefault = composeNoteEl?.textContent ?? noteDefault;
      onStageChange({ active: true, complete: false, disabledReason: '' });
      beginPuzzle();
      return { active: true, reason: '' };
    } catch (error) {
      disabledReason = '語順データを確認できないため、並べ替えを停止しました。この項目をスキップしてください。';
      console.warn('Reordering safely disabled', error);
      return { active: false, reason: disabledReason };
    }
  }

  return {
    reset: clear,
    setup,
    isActive: () => active,
    isComplete: () => complete,
    getDisabledReason: () => disabledReason,
    isAwaitingReorder: () => active,
    getNodes: () => [],
    setDefaultNote: (value) => { noteDefault = String(value ?? ''); },
  };
}
