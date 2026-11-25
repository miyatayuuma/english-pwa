import {
  createLearningBackup, loadBackupCurriculum, MAX_BACKUP_BYTES, parseLearningBackup,
  previewLearningBackup, restoreLearningBackup,
} from '../storage/learningBackup.js';
import { withLearningDataAccess } from '../storage/learningBackupAccess.js';
import { isNativeAndroid } from '../native/runtimePlatform.js';
import { getNativeMedia } from '../native/media.js';
import { clearSetupHandoff } from './sessionSetupHandoff.js';

async function saveFile(backup) {
  const name = `english-pwa-learning-${backup.exportedAt.replace(/[:.]/g, '-')}.json`;
  const text = JSON.stringify(backup);
  const blob = new Blob([text], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new Error('バックアップのサイズが上限を超えています。');
  if (isNativeAndroid()) {
    await (await getNativeMedia()).saveLearningBackup({ name, text });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initializeLearningBackupSettings({ appVersion, isStudyBusy }) {
  const exportButton = document.getElementById('exportLearningBackup');
  const chooseButton = document.getElementById('chooseLearningBackup');
  const input = document.getElementById('learningBackupFile');
  const status = document.getElementById('learningBackupStatus');
  const dialog = document.getElementById('learningRestoreDialog');
  const details = document.getElementById('learningRestoreDetails');
  const confirm = document.getElementById('confirmLearningRestore');
  let pendingBackup;
  let busy = false;

  function requireIdle() {
    if (isStudyBusy()) throw new Error('学習を終了してホームに戻ってから操作してください。');
  }

  async function run(operation) {
    if (busy) return;
    busy = true;
    exportButton.disabled = chooseButton.disabled = confirm.disabled = true;
    status.textContent = '';
    try {
      requireIdle();
      await operation();
    } catch (error) {
      status.textContent = error?.code === 'CANCELLED' ? '保存をキャンセルしました。'
        : error?.message || '学習データを処理できませんでした。';
    } finally {
      busy = false;
      exportButton.disabled = chooseButton.disabled = confirm.disabled = false;
    }
  }

  exportButton.addEventListener('click', () => run(async () => {
    const catalog = await loadBackupCurriculum();
    const curriculum = Object.fromEntries(Object.entries(catalog).map(([key, { hash }]) => [key, hash]));
    const backup = await withLearningDataAccess(() => {
      requireIdle();
      return createLearningBackup(localStorage, { appVersion, curriculum });
    });
    await saveFile(backup);
    status.textContent = 'バックアップの保存を開始しました。';
  }));

  chooseButton.addEventListener('click', () => {
    if (isStudyBusy()) {
      status.textContent = '学習を終了してホームに戻ってから操作してください。';
      return;
    }
    input.click();
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    run(async () => {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('バックアップのサイズが上限を超えています。');
      const backup = parseLearningBackup(await file.text());
      const preview = previewLearningBackup(backup, await loadBackupCurriculum());
      requireIdle();
      const lines = [
        `バックアップ日時 ${new Date(backup.exportedAt).toLocaleString('ja-JP')}（${backup.appVersion}）`,
        `例文 ${preview.sentenceCount}件、語彙 ${preview.vocabularyCount}件、学習記録 ${preview.studyDays}日、セッション集計 ${preview.sessionSummaries}件`,
        preview.sameCurriculum ? '教材は同じ版です。' : '配信中の教材と版が異なります。元の教材 ID で復元します。',
      ];
      if (preview.missingSentences || preview.missingVocabulary || preview.missingCharacters) {
        lines.push(`未収録 ID は例文 ${preview.missingSentences}件、語彙 ${preview.missingVocabulary}件、キャラクター ${preview.missingCharacters}件です。対応する記録も元の ID のまま保存されます。`);
      }
      details.replaceChildren(...lines.map(line => {
        const paragraph = document.createElement('p');
        paragraph.textContent = line;
        return paragraph;
      }));
      pendingBackup = backup;
      dialog.showModal();
    });
  });

  dialog.addEventListener('close', () => { pendingBackup = undefined; });
  confirm.addEventListener('click', () => {
    const backup = pendingBackup;
    if (!backup) return;
    dialog.close();
    run(() => withLearningDataAccess(() => {
      requireIdle();
      restoreLearningBackup(localStorage, backup);
      clearSetupHandoff();
      try { sessionStorage.removeItem('englishPwaPendingGameAction'); } catch (_) {}
    }, { reload: true }));
  });
}
