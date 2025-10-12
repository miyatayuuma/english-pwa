/**
 * アプリ用シート（items / srs_state）のフォーマットのみ作成する。
 * 実行エントリ：buildAppTemplate()
 *
 * 元データは参照しない。空シートを作成し、ヘッダと体裁を設定。
 */
function buildAppTemplate() {
  const ss = SpreadsheetApp.getActive();

  // --- 1) items シート構造 ---
  const itemsHeaders = ['id', 'unit', 'level', 'en', 'ja', 'audio_url', 'chunks_json', 'tags', 'note'];
  const shItems = resetSheet(ss, 'items', itemsHeaders);
  try { shItems.getRange(1, 1, 1, itemsHeaders.length).createFilter(); } catch (_) {}
  Logger.log('items シートを作成しました。');

  // --- 2) srs_state シート構造 ---
  const srsHeaders = ['id', 'reps', 'ease', 'interval', 'due', 'lapses', 'last_result', 'updated_at'];
  const shSrs = resetSheet(ss, 'srs_state', srsHeaders);
  try { shSrs.getRange(1, 1, 1, srsHeaders.length).createFilter(); } catch (_) {}
  Logger.log('srs_state シートを作成しました。');

  // --- 3) レポート ---
  Logger.log('DONE: 空フォーマットを作成しました（items / srs_state）。');
}

/** 指定シートを作り直し（存在すれば内容クリア＆列数調整）、ヘッダと凍結を設定 */
function resetSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear({ contentsOnly: true });
  // 列数調整（不足分のみ追加）
  const needCols = headers.length - sh.getMaxColumns();
  if (needCols > 0) sh.insertColumnsAfter(sh.getMaxColumns(), needCols);
  // ヘッダ設定
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, headers.length);
  return sh;
}
