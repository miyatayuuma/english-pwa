/** ---- WebApp.gs ---- **/

// ===== 設定 =====
const SHEETS = {
  attempts: 'attempts',
  speech:   'speech_metrics',
  sessions: 'sessions',
  items:    'items',
  srs:      'srs_state',
  config:   'config',
};

const SP = PropertiesService.getScriptProperties(); // API_KEY を入れるなら Script properties に保存

// ===== 共通ユーティリティ =====
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// text/plain で送る前提（sendBeacon 互換）
function parseBody_(e) {
  const raw =
    e && e.postData &&
    (e.postData.contents ||
     (e.postData.getDataAsString && e.postData.getDataAsString()));
  if (!raw) throw new Error('empty_body');
  try { return JSON.parse(raw); } catch (_) { throw new Error('invalid_json'); }
}

function checkApiKey_(body) {
  const required = (SP.getProperty('API_KEY') || '').trim();
  if (!required) return true; // キー未設定なら誰でも通す
  return (body && (body.apiKey||'').trim() === required);
}

function book(){ return SpreadsheetApp.getActive(); }

/** 1行目が空ならヘッダ敷設（既存データは触らない） */
function ensureSheet(name, headers){
  const ss = book();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) sh.getRange(1,1,1,headers.length).setValues([headers]);
    return sh;
  }
  if (headers && headers.length) {
    const lastCol = Math.max(sh.getLastColumn(), headers.length);
    const row1 = sh.getRange(1,1,1,lastCol).getValues()[0];
    const hasAny = row1.some(v => String(v).trim() !== '');
    if (!hasAny) sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

// ===== GET: 疎通確認 =====
function doGet(e) {
  return jsonOut({ ok:true, at:new Date().toISOString(), sheets:SHEETS });
}

// ===== POST: ログ受信（attempt/speech/session/bulk/status） =====
const ENTRY_HANDLERS = Object.freeze({
  attempt: appendAttempt_,
  speech:  appendSpeech_,
  session: appendSession_,
  srs:     upsertSrsState_,
});
const SUPPORTED_ENTRY_TYPES = Object.freeze(Object.keys(ENTRY_HANDLERS));
function doPost(e) {
  let body;
  try { body = parseBody_(e); }
  catch (err) { return jsonOut({ ok:false, error:String(err) }); }

  if (!checkApiKey_(body)) return jsonOut({ ok:false, error:'unauthorized' });

  // バルク（オフライン蓄積の一括送信）
  if (body.type === 'bulk' && Array.isArray(body.entries)) {
    const accepted = [];
    body.entries.forEach(entry => {
      try {
        const handled = handleEntry_(entry.type, entry.data, entry.uid);
        if (handled) {
          accepted.push(entry.uid || Utilities.getUuid());
        } else {
          Logger.log('Unsupported entry type in bulk: %s (uid=%s, supported=%s)', entry && entry.type, entry && entry.uid, SUPPORTED_ENTRY_TYPES.join(','));
        }
      } catch (err) {
        Logger.log('Failed to handle bulk entry: %s', err);
        /* 1件失敗しても継続 */
      }
    });
    return jsonOut({ ok:true, accepted });
  }

  // 単発
  try {
    if (body.type === 'status') {
      return jsonOut({ ok:true, status: handleStatus_() });
    }
    if (!handleEntry_(body.type, body.data, body.uid)) {
      Logger.log('Unsupported entry type: %s (uid=%s, supported=%s)', body && body.type, body && body.uid, SUPPORTED_ENTRY_TYPES.join(','));
      return jsonOut({ ok:false, error:'unsupported_type' });
    }
    return jsonOut({ ok:true });
  } catch (err) {
    return jsonOut({ ok:false, error:String(err) });
  }
}

function handleEntry_(type, data, uid) {
  const handler = ENTRY_HANDLERS[type];
  if (!handler) return false; /* unknown type: 無視 */
  handler(data, uid);
  return true;
}

// ===== 行追加 =====
function appendAttempt_(a, uid) {
  const sh = ensureSheet(SHEETS.attempts,
    ['ts','id','result','auto_recall','auto_precision','response_ms',
     'hint_used','hint_stage','hint_en_used','device','client_uid']);
  const row = [
    a?.ts || new Date().toISOString(),
    a?.id || '',
    (a?.result ?? ''),
    (a?.auto_recall ?? ''),
    (a?.auto_precision ?? ''),
    (a?.response_ms ?? ''),
    (a?.hint_used ?? ''),
    (a?.hint_stage ?? ''),
    (a?.hint_en_used ?? ''),
    (a?.device ?? ''),
    a?.client_uid || uid || ''
  ];
  sh.appendRow(row);
}

function appendSpeech_(s, uid) {
  const sh = ensureSheet(SHEETS.speech,
    ['ts','id','mode','wer','cer','latency_ms','words_spoken',
     'transcript','matched_tokens_json','missing_tokens_json',
      'recall','precision','match','hint_stage','level_last','level_best',
     'level5_count','streak','no_hint_successes','next_level_target','next_level_remaining','next_level_available_at',
     'native_sr_submissions','native_sr_successes','client_uid']);
  const row = [
    s?.ts || new Date().toISOString(),
    s?.id || '',
    s?.mode || '',
    (s?.wer ?? ''),
    (s?.cer ?? ''),
    (s?.latency_ms ?? ''),
    (s?.words_spoken ?? ''),
    (s?.transcript || s?.transcript_raw || ''),
    (s?.matched_tokens_json ?? ''),
    (s?.missing_tokens_json ?? ''),
    (s?.recall ?? ''),
    (s?.precision ?? ''),
    (s?.match ?? ''),
    (s?.hint_stage ?? ''),
    (s?.level_last ?? ''),
    (s?.level_best ?? ''),
    (s?.level5_count ?? ''),
    (s?.streak ?? ''),
    (s?.no_hint_successes ?? ''),
    (s?.next_level_target ?? ''),
    (s?.next_level_remaining ?? ''),
    (s?.next_level_available_at ?? ''),
    (s?.native_sr_submissions ?? ''),
    (s?.native_sr_successes ?? ''),
    s?.client_uid || uid || ''
  ];
  sh.appendRow(row);
}

function appendSession_(s, uid) {
  const sh = ensureSheet(SHEETS.sessions,
    ['date','minutes','cards_done','new_introduced','streak','client_uid','at']);
  const row = [
    s?.date || new Date().toISOString().slice(0,10),
    (s?.minutes ?? ''),
    (s?.cards_done ?? ''),
    (s?.new_introduced ?? ''),
    (s?.streak ?? ''),
    s?.client_uid || uid || '',
    new Date().toISOString()
  ];
  sh.appendRow(row);
}

function upsertSrsState_(state, uid) {
  const headers = [
    'ts','id','level_candidate','level_final','level_last','level_best','hint_stage',
    'last_match','no_hint_streak','no_hint_history','last_no_hint_at','level5_count',
    'level_updated_at','promotion_blocked','next_target','client_uid'
  ];
  const sh = ensureSheet(SHEETS.srs, headers);
  const idRaw = state && state.id;
  const id = String(idRaw || '').trim();
  if (!id) return;

  const lastCol = Math.max(sh.getLastColumn(), headers.length);
  let headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  let normalized = headerRow.map(v => String(v || '').trim());
  const headerIndex = new Map();
  normalized.forEach((name, idx) => { if (name) headerIndex.set(name, idx); });
  let appended = 0;
  headers.forEach(name => {
    if (!headerIndex.has(name)) {
      const targetCol = normalized.length + 1;
      sh.getRange(1, targetCol, 1, 1).setValue(name);
      normalized.push(name);
      headerIndex.set(name, targetCol - 1);
      appended++;
    }
  });
  if (appended > 0) {
    const updatedLastCol = Math.max(sh.getLastColumn(), normalized.length);
    headerRow = sh.getRange(1, 1, 1, updatedLastCol).getValues()[0];
    normalized = headerRow.map(v => String(v || '').trim());
  }
  const finalHeaderIndex = new Map();
  normalized.forEach((name, idx) => { if (name) finalHeaderIndex.set(name, idx); });

  const idColIndex = finalHeaderIndex.get('id');
  if (idColIndex == null) return;

  const lastRow = sh.getLastRow();
  let targetRow = lastRow >= 2 ? 0 : 2;
  if (lastRow >= 2) {
    const idValues = sh.getRange(2, idColIndex + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0] || '').trim() === id) {
        targetRow = 2 + i;
        break;
      }
    }
  }
  if (!targetRow || targetRow < 2) {
    targetRow = lastRow + 1;
    if (targetRow < 2) targetRow = 2;
  }

  const totalCols = Math.max(sh.getLastColumn(), normalized.length);
  let rowValues;
  if (targetRow <= lastRow) {
    rowValues = sh.getRange(targetRow, 1, 1, totalCols).getValues()[0];
  } else {
    rowValues = new Array(totalCols).fill('');
  }

  function setColumn(name, value) {
    const idx = finalHeaderIndex.get(name);
    if (idx == null) return;
    if (idx >= rowValues.length) {
      const fillCount = idx - rowValues.length + 1;
      rowValues = rowValues.concat(new Array(fillCount).fill(''));
    }
    rowValues[idx] = value;
  }

  const isoOrEmpty = (value) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0) return '';
      return new Date(value).toISOString();
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed;
    }
    return '';
  };

  const numericOrBlank = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : '';
  };

  const jsonOrEmpty = (value) => {
    if (!value && value !== 0) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length === 0) return '[]';
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  };

  const tsValue = isoOrEmpty(state?.ts) || new Date().toISOString();
  setColumn('ts', tsValue);
  setColumn('id', id);
  setColumn('level_candidate', numericOrBlank(state?.level_candidate));
  setColumn('level_final', numericOrBlank(state?.level_final));
  setColumn('level_last', numericOrBlank(state?.level_last));
  setColumn('level_best', numericOrBlank(state?.level_best));
  setColumn('hint_stage', numericOrBlank(state?.hint_stage));
  setColumn('last_match', numericOrBlank(state?.last_match));
  setColumn('no_hint_streak', numericOrBlank(state?.no_hint_streak));
  const historyValue = Array.isArray(state?.no_hint_history)
    ? jsonOrEmpty(state.no_hint_history)
    : jsonOrEmpty(state?.no_hint_history);
  setColumn('no_hint_history', historyValue);
  setColumn('last_no_hint_at', isoOrEmpty(state?.last_no_hint_at));
  setColumn('level5_count', numericOrBlank(state?.level5_count));
  const updatedAt = isoOrEmpty(state?.level_updated_at || state?.updated_at);
  setColumn('level_updated_at', updatedAt);
  setColumn('promotion_blocked', jsonOrEmpty(state?.promotion_blocked));
  setColumn('next_target', jsonOrEmpty(state?.next_target));
  setColumn('client_uid', state?.client_uid || uid || '');

  if (rowValues.length < totalCols) {
    rowValues = rowValues.concat(new Array(totalCols - rowValues.length).fill(''));
  }
  sh.getRange(targetRow, 1, 1, Math.max(totalCols, rowValues.length)).setValues([rowValues]);
}

// ===== status（任意：ヘッダ用の簡易集計） =====
function handleStatus_(){
  const out = {
    remaining_cards: null,
    remaining_minutes: null,
    minutes_today: 0,
    streak: 0,
  };

  try {
    const ss = book();

    // 今日の学習分数 / streak
    const sess = ss.getSheetByName(SHEETS.sessions);
    if (sess) {
      const lastRow = sess.getLastRow();
      if (lastRow >= 2) {
        const vals = sess.getRange(2,1,lastRow-1,5).getValues(); // date,minutes,cards_done,new_introduced,streak
        const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        let minutesToday = 0;
        let lastStreak = 0;
        vals.forEach(r=>{
          const d = String(r[0]||'').slice(0,10);
          const m = Number(r[1]||0);
          const st= Number(r[4]||0);
          if (d === today) minutesToday += (isFinite(m)?m:0);
          if (isFinite(st)) lastStreak = Math.max(lastStreak, st);
        });
        out.minutes_today = minutesToday;
        out.streak = lastStreak;
      }
    }

    // 残カードは items と srs 状態から簡易推計（なければ null）
    const items = ss.getSheetByName(SHEETS.items);
    if (items) {
      const n = Math.max(0, items.getLastRow()-1);
      out.remaining_cards = n || null;
    }
  } catch(_) {}

  return out;
}
