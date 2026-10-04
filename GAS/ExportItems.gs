/** items シート → 分割JSONを items_json シートへ（Drive権限不要） */
function exportItemsToJsonChunks(){
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('items');
  if (!sh) throw new Error('items シートがありません');

  const values = sh.getDataRange().getValues();
  const head = values.shift();
  const idx = (name) => head.indexOf(name);

  // 必須列
  const must = ['id','en','ja','unit','audio_fn'];
  must.forEach(n => { if (idx(n)===-1) throw new Error('必須列が不足: '+n); });

  // レコード化（空行除外／最小サイズ化のため minify）
  const out = [];
  for (const r of values){
    const en = r[idx('en')], ja = r[idx('ja')];
    if (!en && !ja) continue;
    out.push({
      id:       String(r[idx('id')]),
      en:       String(en||''),
      ja:       String(ja||''),
      unit:     String(r[idx('unit')]),
      audio_fn: String(r[idx('audio_fn')]).trim(),                 // ファイル名のみ
      tags:     (idx('tags')>-1 ? String(r[idx('tags')]) : ''),
      chunks:   (idx('chunks_json')>-1 ? String(r[idx('chunks_json')]) : '[]')
    });
  }
  const json = JSON.stringify(out); // minify（改行なし）

  // 50,000未満に抑える（表示上の安全マージンとして 45,000）
  const MAX = 45000;
  const total = Math.ceil(json.length / MAX);
  const rows = [];
  for (let i=0;i<total;i++){
    const start = i*MAX;
    const part = json.slice(start, start+MAX);
    rows.push([i+1, total, json.length, part]); // A:part, B:total, C:full_len, D:chunk
  }

  let outSh = ss.getSheetByName('items_json');
  if (!outSh) outSh = ss.insertSheet('items_json');
  outSh.clear();
  outSh.getRange(1,1,1,4).setValues([['part','total','json_chars','chunk']]);
  outSh.getRange(2,1,rows.length,4).setValues(rows);
  outSh.setFrozenRows(1);
  outSh.autoResizeColumns(1,4);

  Logger.log('OK: %s parts written to items_json (D2:D%s を順番に結合)', total, total+1);
}

/** （任意）先頭数百文字だけ確認したい場合 */
function previewItemsJsonHead(){
  const sh = SpreadsheetApp.getActive().getSheetByName('items_json');
  if (!sh) throw new Error('items_json がありません');
  const parts = sh.getRange(2,4,Math.max(1, sh.getLastRow()-1),1).getValues().map(r=>String(r[0]));
  const head = (parts[0]||'').slice(0, 400);
  Logger.log(head);
}
