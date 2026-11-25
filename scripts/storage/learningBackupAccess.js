import { hasPendingLearningRestore, recoverLearningRestore } from './learningBackup.js';

const lockName = 'english-pwa-learning-data-v1';
const transferLockName = lockName + ':transfer';
let runtimeLock;
let transferInProgress = false;

function holdRuntimeLock(locks) {
  return new Promise((resolve, reject) => {
    const done = locks.request(lockName, { mode: 'shared' }, () => {
      if (hasPendingLearningRestore(localStorage)) {
        resolve(true);
        return;
      }
      // Keep the lock for the life of this document. Other instances may have
      // in-memory SRS and study-log snapshots, so restoration requires them closed.
      return new Promise(release => {
        runtimeLock = { release, done };
        resolve(false);
      });
    });
    done.catch(reject);
  });
}

export async function prepareLearningStorage() {
  // Access may be denied by browser policy. Preserve normal app startup in
  // this case, with backup and restore unavailable.
  let storage;
  try { storage = globalThis.localStorage; }
  catch { return; }
  if (!storage) return;
  const locks = navigator.locks;
  if (!locks) {
    if (hasPendingLearningRestore(storage)) throw new Error('学習データの復旧には対応ブラウザが必要です。');
    return;
  }
  if (await holdRuntimeLock(locks)) {
    await locks.request(lockName, () => recoverLearningRestore(storage));
    await holdRuntimeLock(locks);
  }
}

export async function withLearningDataAccess(operation, { reload = false } = {}) {
  if (transferInProgress || !runtimeLock) throw new Error('この環境では学習データを操作できません。');
  transferInProgress = true;
  const locks = navigator.locks;
  try {
    // Only one tab can release its shared lock to attempt a transfer. A second
    // tab keeps its shared lock and therefore still blocks the first transfer.
    return await locks.request(transferLockName, { ifAvailable: true }, async transferLock => {
      if (!transferLock) throw new Error('別のタブで学習データを操作中です。');
      const { release, done } = runtimeLock;
      runtimeLock = undefined;
      release();
      try {
        await done;
        return await locks.request(lockName, { ifAvailable: true }, lock => {
          if (!lock) throw new Error('別のタブで English PWA が開いています。閉じてからやり直してください。');
          const result = operation();
          if (reload) {
            location.reload();
            // Keep storage exclusive until the old in-memory runtime is gone.
            return new Promise(() => {});
          }
          return result;
        });
      } finally {
        if (hasPendingLearningRestore(localStorage)) location.reload();
        else await holdRuntimeLock(locks);
      }
    });
  } finally {
    transferInProgress = false;
  }
}
