export const MIC_UI_STATES=Object.freeze({
  OFF:'off',
  PENDING:'pending',
  ACTIVE:'active',
  RELEASE:'release',
  ERROR:'error',
});

const COPY=Object.freeze({
  [MIC_UI_STATES.OFF]:{label:'マイクOFF',button:'マイクを開始'},
  [MIC_UI_STATES.PENDING]:{label:'マイク準備中',button:'マイクを準備中'},
  [MIC_UI_STATES.ACTIVE]:{label:'録音中',button:'録音を停止'},
  [MIC_UI_STATES.RELEASE]:{label:'音声切替中',button:'音声を切り替え中'},
  [MIC_UI_STATES.ERROR]:{label:'マイクエラー',button:'マイクを再試行'},
});

export function normalizeMicUiState(value){
  return Object.values(MIC_UI_STATES).includes(value)?value:MIC_UI_STATES.OFF;
}

export function micStatusCopy(value){
  return COPY[normalizeMicUiState(value)];
}

export function applyMicStatus({statusElement,micButton,state}={}){
  const normalized=normalizeMicUiState(state);
  const copy=micStatusCopy(normalized);
  if(statusElement){
    statusElement.dataset.state=normalized;
    statusElement.setAttribute?.('aria-label',copy.label);
    const label=statusElement.querySelector?.('[data-mic-status-label]');
    if(label) label.textContent=copy.label;
    else statusElement.textContent=copy.label;
  }
  if(micButton){
    micButton.dataset.micState=normalized;
    micButton.classList?.toggle?.('recording',normalized===MIC_UI_STATES.ACTIVE);
    micButton.setAttribute?.('aria-label',copy.button);
    micButton.setAttribute?.('aria-pressed',normalized===MIC_UI_STATES.ACTIVE?'true':'false');
  }
  return normalized;
}
