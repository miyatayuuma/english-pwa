/** =========================================================
 * WebApp.gs — API受信・書き込み（汎用テンプレート）
 * =======================================================*/

// GET: 動作確認用
function doGet(e){
  return json_({ok:true, at:new Date().toISOString(), sheets:Object.keys(SHEETS)});
}

// POST: API受信・書き込み
function doPost(e){
  let body={};
  try{ body = JSON.parse(e.postData?.contents || '{}'); }catch(_){}
  const apiKey=getApiKey_();
  if(apiKey && body.apiKey!==apiKey) return json_({ok:false,error:'Auth failed'});

  const type=String(body.type||'');
  const tz=Session.getScriptTimeZone()||'Asia/Tokyo';
  const now=new Date();

  if(type==='attempt'){
    const ok=logAttempt_(body.data||{}, now);
    return json_({ok:ok});
  }else if(type==='speech'){
    const ok=logSpeech_(body.data||{}, now);
    return json_({ok:ok});
  }else if(type==='session'){
    const ok=logSession_(body.data||{}, now, tz);
    return json_({ok:ok});
  }else if(type==='bulk'){
    const entries=Array.isArray(body.entries)?body.entries:[];
    const accepted=[];
    for(const entry of entries){
      if(!entry) continue;
      const payload=entry.data||{};
      if(payload && !payload.client_uid && entry.uid){
        payload.client_uid = entry.uid;
      }
      const t=String(entry.type||'');
      let ok=false;
      if(t==='attempt') ok = logAttempt_(payload, now);
      else if(t==='speech') ok = logSpeech_(payload, now);
      else if(t==='session') ok = logSession_(payload, now, tz);
      if(ok && entry.uid) accepted.push(entry.uid);
      else if(ok && payload.client_uid) accepted.push(String(payload.client_uid));
    }
    return json_({ok:true, accepted});
  }else if(type==='status'){
    const status=getLearningStatus_();
    return json_({ok:true,status});
  }

  return json_({ok:false,error:'unknown type'});
}

/** 共通: 行追加（ヘッダ自動整合） */
function appendRow_(sheetName, headers, obj){
  const sh = SPREADSHEET.getSheetByName(sheetName);
  if(!sh) throw new Error('missing sheet: '+sheetName);
  if(sh.getMaxColumns()<headers.length){
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  const curHead = sh.getRange(1,1,1,headers.length).getValues()[0];
  if(!curHead.every((h,i)=>h===headers[i])){
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
  }
  const uidCol=headers.indexOf('client_uid');
  let uid='';
  if(uidCol>-1){
    uid=String(obj.client_uid || obj.clientUid || '').trim();
    if(uid){
      const lastRow=sh.getLastRow();
      if(lastRow>=2){
        const vals=sh.getRange(2, uidCol+1, lastRow-1, 1).getValues().flat();
        if(vals.includes(uid)) return true;
      }
    }
  }
  const row = headers.map(k=>{
    if(k==='client_uid') return uid || String(obj[k]||'');
    return obj[k]!==undefined?obj[k]:'';
  });
  sh.appendRow(row);
  return true;
}

/** JSONレスポンス */
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin','*')
    .setHeader('Access-Control-Allow-Headers','Content-Type');
}

function logAttempt_(d, now){
  const row={
    ts:String(d.ts||now.toISOString()),
    id:sanitizeString_(d.id,32),
    mode:sanitizeString_(d.mode,16),
    response_ms:sanitizeNumber_(d.response_ms,0,0,600000),
    result:sanitizeNumber_(d.result,0,0,3),
    hint_used:!!d.hint_used,
    device:sanitizeString_(d.device,256),
    client_uid:sanitizeString_(d.client_uid,64)
  };
  return appendRow_('attempts',HEAD.attempts,row);
}

function logSpeech_(d, now){
  const row={
    ts:String(d.ts||now.toISOString()),
    id:sanitizeString_(d.id,32),
    mode:sanitizeString_(d.mode,16),
    wer:sanitizeNumber_(d.wer,1,0,1),
    cer:sanitizeNumber_(d.cer,1,0,1),
    latency_ms:sanitizeNumber_(d.latency_ms,0,0,120000),
    asr_conf:sanitizeString_(d.asr_conf,32),
    duration_ms:sanitizeNumber_(d.duration_ms,0,0,600000),
    words_spoken:sanitizeNumber_(d.words_spoken,0,0,1000),
    client_uid:sanitizeString_(d.client_uid,64)
  };
  return appendRow_('speech_metrics',HEAD.speech,row);
}

function logSession_(d, now, tz){
  const row={
    date:Utilities.formatDate(d.date?new Date(d.date):now,tz,'yyyy-MM-dd'),
    minutes:sanitizeNumber_(d.minutes,0,0,1440),
    cards_done:sanitizeNumber_(d.cards_done,0,0,100000),
    new_introduced:sanitizeNumber_(d.new_introduced,0,0,100000),
    streak:sanitizeString_(d.streak,16),
    client_uid:sanitizeString_(d.client_uid,64)
  };
  return appendRow_('sessions',HEAD.sessions,row);
}
