/** ---- SRS.gs ---- **/

function sh(name){ return SpreadsheetApp.getActive().getSheetByName(name); }
function idxHead_(sheet){ return sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String); }
function c_(arr, name){ return arr.indexOf(name); }  // ヘッダ -> 0-based index

/** SM-2 互換の更新（q: 0-5） */
function applySM2_(EF_prev, reps, lapses, interval_prev, q){
  let EF = EF_prev + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  EF = Math.max(1.3, Math.min(2.5, EF));

  let nextReps = reps;
  let nextLapses = lapses;
  let interval;

  const pass = (q >= 3);
  if (!pass){
    nextReps = 0;
    nextLapses = lapses + 1;
    interval = 1;
  } else {
    if (reps <= 0)      { interval = 1; nextReps = 1; }
    else if (reps === 1){ interval = 6; nextReps = 2; }
    else                { interval = Math.max(1, Math.round(interval_prev * EF)); nextReps = reps + 1; }
  }

  const due = new Date();
  due.setUTCDate(due.getUTCDate() + interval);
  return {EF, nextReps, nextLapses, interval, dueISO: Utilities.formatDate(due,'UTC',"yyyy-MM-dd'T'HH:mm:ss'Z'"), pass};
}

/** attempt を保存し、SRS を更新 */
function handleAttempt_(data){
  // ログ保存
  const a = sh(SHEETS.ATTEMPTS);
  a.appendRow([
    new Date(),
    data.id||'',
    Number(data.result||0),
    Number(data.response_ms||0),
    !!data.hint_used,
    String(data.device||''),
    String(data.client_uid||''),
    (data.auto_recall!=null? Number(data.auto_recall): ''),
    (data.auto_precision!=null? Number(data.auto_precision): ''),
    (data.hint_stage!=null? Number(data.hint_stage): '')
  ]);

  // SRS 更新
  updateSRSOnAttempt_(data);
}

/** speech を保存（分析用ログ） */
function handleSpeech_(data){
  const s = sh(SHEETS.SPEECH);
  s.appendRow([
    new Date(),
    data.id||'',
    (data.recall!=null? Number(data.recall): ''),
    (data.precision!=null? Number(data.precision): ''),
    (data.match!=null? Number(data.match): ''),
    String(data.transcript||''),
    Number(data.words_spoken||0),
    Number(data.latency_ms||0)
  ]);
}

/** bulk 受信（任意：送信バッファの一括取り込み） */
function handleBulk_(entries){
  const accepted=[];
  for (const ent of entries||[]){
    try{
      if (ent.type==='attempt') handleAttempt_(ent.data||{});
      else if (ent.type==='speech') handleSpeech_(ent.data||{});
      accepted.push(ent.uid||'');
    }catch(_){}
  }
  return {ok:true, accepted};
}

/** q の算出（前端から match/hint_stage が来ていれば利用。無ければ result ベース） */
function estimateQuality_(data){
  // 1) 推奨：attempt に match(0..1), hint_stage(0/1/2) が来る想定
  if (data.match != null){
    const m = Number(data.match);
    const h = Number(data.hint_stage||0);
    if (m >= 0.95 && h<=0) return 5;
    if (m >= 0.85) return 4;
    if (m >= 0.70) return 3;
    return 2;
  }
  // 2) フォールバック：result のみ（◯=1, ×=0）
  return Number(data.result||0) ? 4 : 2;  // 合格は「良い」側に寄せる
}

/** items 1件の SRS 行を探す（無ければ追加） */
function getOrCreateSRSRow_(id){
  const srs = sh(SHEETS.SRS);
  const vals = srs.getDataRange().getValues();
  const head = vals[0].map(String);
  const ci = (n)=> head.indexOf(n);
  let rowIdx = -1;
  for (let i=1;i<vals.length;i++){
    if (String(vals[i][ci('id')])===String(id)){
      rowIdx=i; break;
    }
  }
  if (rowIdx<0){
    srs.appendRow([id, 2.5, 0, '', 0, 0, 0, '', '', '']);
    rowIdx = srs.getLastRow()-1; // 0-based（データ部）
  }
  return {sheet:srs, head, row:rowIdx+1}; // 1-based（データ最初=2行目）
}

/** attempt 到着時に SRS 更新 */
function updateSRSOnAttempt_(data){
  const id = String(data.id||'').trim();
  if (!id) return;

  const {sheet, head, row} = getOrCreateSRSRow_(id);
  const col = (n)=> head.indexOf(n)+1;

  const EF_prev = Number(sheet.getRange(row, col('ease')).getValue() || 2.5);
  const reps    = Number(sheet.getRange(row, col('reps')).getValue() || 0);
  const lapses  = Number(sheet.getRange(row, col('lapses')).getValue() || 0);
  const ivPrev  = Number(sheet.getRange(row, col('interval_d')).getValue() || 0);

  const q = estimateQuality_(data);
  const up = applySM2_(EF_prev, reps, lapses, ivPrev, q);

  sheet.getRange(row, col('ease')).setValue(up.EF);
  sheet.getRange(row, col('interval_d')).setValue(up.interval);
  sheet.getRange(row, col('due_utc')).setValue(up.dueISO);
  sheet.getRange(row, col('reps')).setValue(up.nextReps);
  sheet.getRange(row, col('lapses')).setValue(up.nextLapses);
  sheet.getRange(row, col('last_result')).setValue(up.pass?1:0);
  sheet.getRange(row, col('last_ts')).setValue(new Date());
}

/** 進捗サマリ（必要なら UI に表示する用） */
function handleStatus_(){
  const items = sh(SHEETS.ITEMS).getDataRange().getValues();
  const hI = items[0].map(String), cI = (n)=>hI.indexOf(n);
  const rowsI = items.slice(1);

  const srs = sh(SHEETS.SRS).getDataRange().getValues();
  const hS = srs[0].map(String),  cS = (n)=>hS.indexOf(n);
  const rowsS = srs.slice(1);
  const map = new Map(rowsS.map(r=>[String(r[cS('id')]), r]));

  const today = new Date();
  const total = rowsI.length;
  let due=0, mature=0;
  const sections = {};

  for (const r of rowsI){
    const id=String(r[cI('id')]); const unit=String(r[cI('unit')]);
    const S = map.get(id);
    let isDue=true, isMature=false;
    if (S){
      const dueISO = S[cS('due_utc')];
      const iv = Number(S[cS('interval_d')])||0;
      const ok = Number(S[cS('last_result')])||0;
      isDue = dueISO ? (new Date(dueISO) <= today) : true;
      if (iv>=21 && ok===1) isMature=true;
    }
    if (isDue) due++;
    if (isMature) mature++;
    if (!sections[unit]) sections[unit]={total:0,mature:0};
    sections[unit].total++; if(isMature) sections[unit].mature++;
  }

  return {ok:true, status:{ total_cards:total, due_today:due, mature, sections }};
}
