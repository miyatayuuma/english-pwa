import { getNativeGameTrace } from '../native/nativeSpeech.js';
import { isNativeAndroid } from '../native/runtimePlatform.js';
import { gameTraceCollector, setGameTraceCaptureEnabled } from '../native/gameTrace.js';

let nativeBridge = null;
let capabilityEventInstalled = false;
let panel = null;
let expanded = false;

function decisionLabel(attempt) {
  const finalEvent = [...(attempt?.events || [])].reverse().find(event =>
    event.type === 'final-ui-result-committed' || event.type === 'game-grading-completed');
  const decision = finalEvent?.decision ?? finalEvent?.finalDecision;
  if (typeof decision === 'string') return decision;
  if (decision && typeof decision === 'object') {
    return String(decision.type || decision.outcome || (decision.pass === true ? 'PASS' : decision.pass === false ? 'FAIL' : '—'));
  }
  return '—';
}

function latestStatus(attempt) {
  if (!attempt) return '待機';
  const last = attempt.events.at(-1)?.type;
  if (last === 'attempt-closed') return '試行終了';
  if (attempt.recognitionStatus === 'listening') return '認識中';
  if (attempt.recognitionStatus === 'interim') return '途中認識';
  if (attempt.recognitionStatus === 'final-pending-terminal') return '最終候補・終了待ち';
  if (attempt.recognitionStatus === 'terminal') return '認識終了';
  if (attempt.recognitionStatus === 'error') return '認識エラー';
  if (attempt.recognitionStatus === 'cancelled') return 'キャンセル';
  return '要求済み';
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard access is unavailable');
}

function ensurePanel() {
  if (panel?.isConnected) return panel;
  panel = document.createElement('aside');
  panel.id = 'nativeGameTracePanel';
  panel.setAttribute('aria-label', 'Android game trace diagnostics');
  panel.innerHTML = `
    <style>
      #nativeGameTracePanel{position:fixed;z-index:2147483000;right:7px;top:calc(7px + env(safe-area-inset-top));width:min(292px,calc(100vw - 14px));max-height:42dvh;pointer-events:none;font:12px/1.35 system-ui,sans-serif;color:#f4f7ff}
      #nativeGameTracePanel *{box-sizing:border-box}
      #nativeGameTracePanel .ngt-box{pointer-events:auto;background:rgba(9,15,27,.94);border:1px solid rgba(174,196,240,.42);border-radius:10px;box-shadow:0 4px 18px #0005;overflow:hidden;backdrop-filter:blur(8px)}
      #nativeGameTracePanel .ngt-head{display:flex;align-items:center;gap:6px;padding:5px 7px}
      #nativeGameTracePanel .ngt-head strong{flex:1;font-size:11px;letter-spacing:.04em}
      #nativeGameTracePanel button{min-height:32px;border:1px solid #62708a;border-radius:7px;background:#202b3d;color:#fff;padding:4px 7px;font:inherit;touch-action:manipulation}
      #nativeGameTracePanel button:active{background:#354867}
      #nativeGameTracePanel .ngt-body{display:none;max-height:calc(42dvh - 42px);overflow:auto;padding:4px 7px 7px}
      #nativeGameTracePanel[data-expanded="true"] .ngt-body{display:block}
      #nativeGameTracePanel .ngt-status{display:grid;grid-template-columns:auto 1fr;gap:3px 8px;margin:3px 0 7px;color:#dce6f6}
      #nativeGameTracePanel .ngt-status span:nth-child(odd){opacity:.68}
      #nativeGameTracePanel .ngt-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}
      #nativeGameTracePanel .ngt-timeline{display:grid;gap:2px;max-height:88px;overflow:auto;margin-top:7px;padding:5px 6px;border-radius:6px;background:#121b29;color:#c2cee0;font:10px/1.35 ui-monospace,monospace}
      #nativeGameTracePanel .ngt-timeline:empty::before{content:'イベントはまだありません';opacity:.62}
      #nativeGameTracePanel .ngt-note{margin:7px 0 0;opacity:.67;font-size:10px}
      #nativeGameTracePanel .ngt-message{min-height:14px;margin-top:5px;color:#b8e6c9}
      @media(max-width:380px){#nativeGameTracePanel{width:min(260px,calc(100vw - 14px))}}
    </style>
    <div class="ngt-box">
      <div class="ngt-head"><strong>GAME TRACE</strong><button type="button" data-action="toggle-capture" aria-pressed="false">Trace OFF</button><button type="button" data-action="expand" aria-expanded="false">開く</button></div>
      <div class="ngt-body">
        <div class="ngt-status"><span>attempt</span><b data-value="attempt">—</b><span>recognition</span><b data-value="status">待機</b><span>decision</span><b data-value="decision">—</b><span>events</span><b data-value="events">0</b></div>
        <div class="ngt-actions">
          <button type="button" data-action="copy-latest">最新をコピー</button>
          <button type="button" data-action="copy-all">全件JSONをコピー</button>
          <button type="button" data-action="copy-metadata">伏字JSONをコピー</button>
          <button type="button" data-action="clear">記録を消去</button>
        </div>
        <div class="ngt-timeline" role="log" aria-label="最新試行のイベント順序"></div>
        <p class="ngt-note">原文を含む記録は、このボタンを押したときだけコピーされます。記録はメモリ内のみです。</p>
        <div class="ngt-message" aria-live="polite"></div>
      </div>
    </div>`;
  document.body.append(panel);
  panel.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'toggle-capture') {
      const requested = !gameTraceCollector.isEnabled();
      button.disabled = true;
      setGameTraceCaptureEnabled(requested).then(enabled => {
        refreshPanel();
        if(requested&&!enabled) showMessage('Android debug起動を確認できません');
      }).catch(()=>showMessage('Traceを切り替えられませんでした'))
        .finally(()=>{button.disabled=false;});
    } else if (action === 'expand') {
      expanded = !expanded;
      panel.dataset.expanded = String(expanded);
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? '閉じる' : '開く';
    } else if (action === 'clear') {
      gameTraceCollector.clear();
      showMessage('記録を消去しました');
      refreshPanel();
    } else if (action === 'copy-latest') {
      copyLatest();
    } else if (action === 'copy-all') {
      copyExport(false);
    } else if (action === 'copy-metadata') {
      copyExport(true);
    }
  });
  refreshPanel();
  return panel;
}

function showMessage(message) {
  const target = panel?.querySelector('.ngt-message');
  if (target) target.textContent = message;
}

async function copyLatest() {
  try {
    if (!gameTraceCollector.getLatest()) { showMessage('コピーできる試行がありません'); return; }
    await copyText(gameTraceCollector.exportJSON({ latestOnly: true }));
    showMessage('最新の試行JSONをコピーしました');
  } catch (_) { showMessage('コピーできませんでした'); }
}

async function copyExport(metadataOnly) {
  try {
    if (!gameTraceCollector.list().length) { showMessage('コピーできる試行がありません'); return; }
    await copyText(gameTraceCollector.exportJSON({ metadataOnly }));
    showMessage(metadataOnly ? '伏字JSONをコピーしました' : '全件JSONをコピーしました');
  } catch (_) { showMessage('コピーできませんでした'); }
}

export function refreshPanel() {
  if (!panel?.isConnected) return;
  const latest = gameTraceCollector.getLatest();
  const button = panel.querySelector('[data-action="toggle-capture"]');
  button.textContent = gameTraceCollector.isEnabled() ? 'Trace ON' : 'Trace OFF';
  button.setAttribute('aria-pressed', String(gameTraceCollector.isEnabled()));
  panel.querySelector('[data-value="attempt"]').textContent = latest?.attemptId ?? '—';
  panel.querySelector('[data-value="status"]').textContent = latestStatus(latest);
  panel.querySelector('[data-value="decision"]').textContent = decisionLabel(latest);
  panel.querySelector('[data-value="events"]').textContent = String(latest?.events?.length ?? 0);
  const timeline=panel.querySelector('.ngt-timeline');
  timeline.replaceChildren(...(latest?.events||[]).slice(-12).map(event=>{
    const row=document.createElement('div');
    row.textContent=`#${event.sequence} ${event.type}`;
    return row;
  }));
}

function onCollectorChange() {
  refreshPanel();
}

export async function initializeGameTracePanel() {
  if (!isNativeAndroid()) return false;
  try {
    nativeBridge = await getNativeGameTrace();
    const capability = await nativeBridge.getCapability();
    if (!capability?.available) return false;
    if (capability.enabled) ensurePanel();
    if (!capabilityEventInstalled) {
      capabilityEventInstalled = true;
      window.addEventListener('native-game-trace-launch-updated', async () => {
        try {
          const next = await nativeBridge.getCapability();
          if (next?.available && next?.enabled) ensurePanel();
          else {
            await setGameTraceCaptureEnabled(false);
            panel?.remove();
            panel = null;
            expanded = false;
          }
        } catch (_) {
          await setGameTraceCaptureEnabled(false);
          panel?.remove();
          panel = null;
          expanded = false;
        }
      });
      gameTraceCollector.subscribe(onCollectorChange);
    }
    return capability.enabled === true;
  } catch (_) {
    return false;
  }
}

export function isGameTraceCapabilityEnabled() {
  return !!panel?.isConnected && gameTraceCollector.isEnabled();
}
