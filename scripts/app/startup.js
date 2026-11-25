import { prepareLearningStorage } from '../storage/learningBackupAccess.js';

// Recover before main.js or any of its dependencies read persisted state.
try {
  await prepareLearningStorage();
  await import('./main.js');
} catch (error) {
  const status = document.createElement('p');
  status.className = 'muted';
  status.setAttribute('role', 'alert');
  status.textContent = '学習データを読み込めませんでした。アプリを開き直してください。';
  document.getElementById('app').replaceChildren(status);
  document.getElementById('loadingOverlay')?.remove();
  console.error('English PWA startup failed', error);
}
