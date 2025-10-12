/** =========================================================
 * ConfigAndCore.gs
 * ---------------------------------------------------------
 * 軽量テンプレート構築・Web連携・共通ヘルパー統合版
 * データなしでアプリ用シート構造を自動準備する。
 * =======================================================*/

/** === Config === */
const SPREADSHEET = SpreadsheetApp.getActiveSpreadsheet();
const SHEETS = {
  attempts: 'attempts',
  speech: 'speech_metrics',
  sessions: 'sessions',
  items: 'items',
  srs: 'srs_state',
  config: 'config'
};

const HEAD = {
  attempts: ['ts','id','mode','response_ms','result','hint_used','device','client_uid'],
  speech:   ['ts','id','mode','wer','cer','latency_ms','asr_conf','duration_ms','words_spoken','client_uid'],
  sessions: ['date','minutes','cards_done','new_introduced','streak','client_uid'],
  items:    ['id','unit','level','en','ja','audio_url','chunks_json','tags','note'],
  srs:      ['id','reps','ease','interval','due','lapses','last_result','updated_at'],
  config:   ['key','value']
};

/** === 共通シート操作 === */
function sh_(name){
  const sh = SPREADSHEET.getSheetByName(name);
  if (!sh) throw new Error('missing sheet: ' + name);
  return sh;
}

function ensureSheet_(ss, name, headers){
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const w = headers.length;
  if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
  sh.clear({contentsOnly:true});
  sh.getRange(1,1,1,w).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1,w);
  try{ sh.getRange(1,1,1,w).createFilter(); }catch(_){}
  return sh;
}

/** === ISO日付 === */
function isoDate_(d=new Date()){
  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

/** === APIキー取得 === */
function getApiKey_(){
  return PropertiesService.getScriptProperties().getProperty('API_KEY') || '';
}

function sanitizeString_(value, max){
  const str = value==null ? '' : String(value);
  return max!=null ? str.slice(0, max).replace(/[\r\n]+/g,' ') : str.replace(/[\r\n]+/g,' ');
}

function sanitizeNumber_(value, def, min, max){
  let num = Number(value);
  if(isNaN(num)) num = def;
  if(min!=null && num<min) num = min;
  if(max!=null && num>max) num = max;
  return num;
}

function numberSafe_(value){
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

function getConfigMap_(){
  const map = {};
  const sh = SPREADSHEET.getSheetByName(SHEETS.config);
  if(!sh) return map;
  const values = sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++){
    const row = values[i];
    const key = String(row[0]||'').trim();
    if(!key) continue;
    map[key] = row[1];
  }
  return map;
}

function getLearningStatus_(){
  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const today = isoDate_(new Date());
  const out = {
    date: today,
    minutes_today: 0,
    cards_today: 0,
    new_today: 0,
    streak: 0,
    goal_cards: 0,
    goal_minutes: 0,
    remaining_cards: null,
    remaining_minutes: null
  };
  const sessionSheet = SPREADSHEET.getSheetByName(SHEETS.sessions);
  if(sessionSheet){
    const values = sessionSheet.getDataRange().getValues();
    for(let i=1;i<values.length;i++){
      const row = values[i];
      const rawDate = row[0];
      const dateStr = rawDate instanceof Date ? Utilities.formatDate(rawDate, tz, 'yyyy-MM-dd') : String(rawDate||'');
      if(dateStr === today){
        out.minutes_today += numberSafe_(row[1]);
        out.cards_today += numberSafe_(row[2]);
        out.new_today += numberSafe_(row[3]);
      }
      const streakVal = Number(row[4]);
      if(!isNaN(streakVal)){
        out.streak = streakVal;
      }
    }
  }
  const cfg = getConfigMap_();
  out.goal_cards = numberSafe_(cfg.daily_card_goal);
  out.goal_minutes = numberSafe_(cfg.daily_minutes_goal);
  if(out.goal_cards){
    out.remaining_cards = Math.max(0, out.goal_cards - out.cards_today);
  }
  if(out.goal_minutes){
    out.remaining_minutes = Math.max(0, out.goal_minutes - out.minutes_today);
  }
  return out;
}

/** =========================================================
 * 初期セットアップ（Bootstrap + BuildAppTemplate 統合）
 * =======================================================*/
function setupAppTemplate(){
  const ss = SPREADSHEET;
  // ログ・学習関連の空テンプレートを準備
  ensureSheet_(ss, SHEETS.attempts, HEAD.attempts);
  ensureSheet_(ss, SHEETS.speech, HEAD.speech);
  ensureSheet_(ss, SHEETS.sessions, HEAD.sessions);
  ensureSheet_(ss, SHEETS.items, HEAD.items);
  ensureSheet_(ss, SHEETS.srs, HEAD.srs);
  ensureSheet_(ss, SHEETS.config, HEAD.config);

  // config初期値
  const sh = ss.getSheetByName('config');
  if (sh.getLastRow() < 2){
    const rows = [
      ['daily_minutes_goal','15'],
      ['daily_card_goal','30'],
      ['new_limit','10'],
      ['speed_default','1.0']
    ];
    sh.getRange(2,1,rows.length,2).setValues(rows);
  }

  Logger.log('OK: 全シートのテンプレートを構築しました。');
}

/** =========================================================
 * items → JSON 分割出力（空でも構造チェック可）
 * =======================================================*/
function exportItemsToJsonChunks(){
  const ss = SPREADSHEET;
  const sh = ss.getSheetByName('items');
  if (!sh) throw new Error('items シートがありません');
  const values = sh.getDataRange().getValues();
  if (values.length < 2) throw new Error('items シートが空です');

  const head = values.shift();
  const idx = name => head.indexOf(name);
  ['id','en','ja','unit','audio_url'].forEach(n=>{
    if (idx(n)===-1) throw new Error('必須列が不足: '+n);
  });

  const out = [];
  for (const r of values){
    const en=r[idx('en')], ja=r[idx('ja')];
    if (!en && !ja) continue;
    out.push({
      id:String(r[idx('id')]),
      en:String(en||''), ja:String(ja||''),
      unit:String(r[idx('unit')]),
      audio_fn:String(r[idx('audio_url')]).trim(),
      tags:(idx('tags')>-1?String(r[idx('tags')]):''),
      chunks:(idx('chunks_json')>-1?String(r[idx('chunks_json')]):'[]')
    });
  }

  const json = JSON.stringify(out);
  const MAX=45000;
  const total=Math.ceil(json.length/MAX);
  const rows=[];
  for(let i=0;i<total;i++){
    const start=i*MAX;
    const part=json.slice(start,start+MAX);
    rows.push([i+1,total,json.length,part]);
  }

  let outSh=ss.getSheetByName('items_json');
  if(!outSh) outSh=ss.insertSheet('items_json');
  outSh.clear();
  outSh.getRange(1,1,1,4).setValues([['part','total','json_chars','chunk']]);
  outSh.getRange(2,1,rows.length,4).setValues(rows);
  outSh.setFrozenRows(1);
  outSh.autoResizeColumns(1,4);
  Logger.log(`OK: ${total} parts written to items_json`);
}
