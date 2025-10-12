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
  const d=body.data||{};
  const now=new Date();
  const tz=Session.getScriptTimeZone()||'Asia/Tokyo';
  const S=(s,max)=>String(s||'').slice(0,max).replace(/[\r\n]+/g,' ');
  const N=(v,def,min,max)=>{v=Number(v);if(isNaN(v))v=def;if(min!=null&&v<min)v=min;if(max!=null&&v>max)v=max;return v;};

  if(type==='attempt'){
    const row={ts:now.toISOString(),id:S(d.id,32),mode:S(d.mode,16),response_ms:N(d.response_ms,0,0,600000),result:N(d.result,0,0,3),hint_used:!!d.hint_used,device:S(d.device,256)};
    appendRow_('attempts',HEAD.attempts,row);
  }else if(type==='speech'){
    const row={ts:now.toISOString(),id:S(d.id,32),mode:S(d.mode,16),wer:N(d.wer,1,0,1),cer:N(d.cer,1,0,1),latency_ms:N(d.latency_ms,0,0,120000),asr_conf:S(d.asr_conf,32),duration_ms:N(d.duration_ms,0,0,600000),words_spoken:N(d.words_spoken,0,0,1000)};
    appendRow_('speech_metrics',HEAD.speech,row);
  }else if(type==='session'){
    const row={date:Utilities.formatDate(now,tz,'yyyy-MM-dd'),minutes:N(d.minutes,0,0,1440),cards_done:N(d.cards_done,0,0,100000),new_introduced:N(d.new_introduced,0,0,100000),streak:S(d.streak,16)};
    appendRow_('sessions',HEAD.sessions,row);
  }else{
    return json_({ok:false,error:'unknown type'});
  }

  return json_({ok:true});
}

/** 共通: 行追加（ヘッダ自動整合） */
function appendRow_(sheetName, headers, obj){
  const sh = SPREADSHEET.getSheetByName(sheetName);
  if(!sh) throw new Error('missing sheet: '+sheetName);
  const curHead = sh.getRange(1,1,1,headers.length).getValues()[0];
  if(!curHead.every((h,i)=>h===headers[i])){
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
  }
  const row = headers.map(k=>obj[k]!==undefined?obj[k]:'');
  sh.appendRow(row);
}

/** JSONレスポンス */
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
