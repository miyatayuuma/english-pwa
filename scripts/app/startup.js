// Recover before main.js or any of its dependencies read persisted state.
try {
  // Do not mix new HTML with the old worker's cached application modules.
  await globalThis.__ENGLISH_PWA_SW_BOOTSTRAP__?.ready;
  const { prepareLearningStorage } = await import('../storage/learningBackupAccess.js');
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
