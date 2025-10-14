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
        handleEntry_(entry.type, entry.data, entry.uid);
        accepted.push(entry.uid || Utilities.getUuid());
      } catch (_) { /* 1件失敗しても継続 */ }
    });
    return jsonOut({ ok:true, accepted });
  }

  // 単発
  try {
    if (body.type === 'status') {
      return jsonOut({ ok:true, status: handleStatus_() });
    }
    handleEntry_(body.type, body.data, body.uid);
    return jsonOut({ ok:true });
  } catch (err) {
    return jsonOut({ ok:false, error:String(err) });
  }
}

function handleEntry_(type, data, uid) {
  switch (type) {
    case 'attempt':  appendAttempt_(data, uid); break;
    case 'speech':   appendSpeech_(data, uid);  break;
    case 'session':  appendSession_(data, uid); break;
    default: /* unknown type: 無視 */ ;
  }
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
     'recall','precision','match','hint_stage','level_last','level_best','client_uid']);
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
