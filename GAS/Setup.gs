/** ---- Setup.gs (safe / non-destructive) ---- **/

// Offline source schema only; no application runtime connection.
const SHEETS_SETUP = {
  ITEMS:    'items',
};

function sh_(name){ return SpreadsheetApp.getActive().getSheetByName(name); }

/**
 * 非破壊ヘッダー整備：
 * - シートが無ければ作成して headers を設定
 * - シートがあれば既存1行目ヘッダーを保持し、欠けている列ヘッダーだけ右端に追加
 * - データは一切消さない
 */
function ensureSheetSafe_(name, headers){
  let s = sh_(name);
  if (!s) {
    s = SpreadsheetApp.getActive().insertSheet(name);
    s.getRange(1, 1, 1, headers.length).setValues([headers]);
    return s;
  }

  const lastCol = Math.max(1, s.getLastColumn());
  const existing = s.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || '').trim());

  // 1行目が空っぽ（データだけある等）の場合は、先頭行にヘッダーを敷く
  const hasAnyHeader = existing.some(v => v.length > 0);
  if (!hasAnyHeader) {
    s.getRange(1, 1, 1, headers.length).setValues([headers]);
    return s;
  }

  // 既存ヘッダーを尊重しつつ、欠損だけ追加
  const existingSet = new Set(existing.filter(Boolean));
  const missing = headers.filter(h => !existingSet.has(h));

  if (missing.length > 0) {
    s.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }

  return s;
}

/** 変更点プレビュー（書き換え無しでログ出力） */
function checkSheets(){
  const defs = [
    // items はフロントの items.json に対応
    [SHEETS_SETUP.ITEMS,    ['id','unit','en','ja','audio_fn','tags']],




  ];

  defs.forEach(([name, headers])=>{
    const s = sh_(name);
    if (!s) { console.log(`[${name}] シートが存在しない → 新規作成されます`); return; }
    const lastCol = Math.max(1, s.getLastColumn());
    const existing = s.getRange(1,1,1,lastCol).getValues()[0].map(v=>String(v||'').trim());
    const existingSet = new Set(existing.filter(Boolean));
    const missing = headers.filter(h => !existingSet.has(h));
    if (missing.length) {
      console.log(`[${name}] 欠損ヘッダー → 追加予定: ${missing.join(', ')}`);
    } else {
      console.log(`[${name}] OK（追加入りません）`);
    }
  });
  SpreadsheetApp.getUi().alert('ログ（表示→ログ）で内容を確認してください。');
}

/** 初期セットアップ（安全版） */
function setupSheets(){
  ensureSheetSafe_(SHEETS_SETUP.ITEMS,    ['id','unit','en','ja','audio_fn','tags']);
  SpreadsheetApp.getUi().alert('非破壊セットアップ完了：既存データは保持されました。');
}
