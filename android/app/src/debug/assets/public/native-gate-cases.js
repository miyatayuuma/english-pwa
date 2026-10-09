// Device acceptance guides, not substitute grading or SRS results.
// D01-D14 require the ordinary game + GAME TRACE for final acceptance.
export const ASR_08D_CASES = Object.freeze([
  { id: 'D01', title: 'Vocabulary 正しい全文', fixture: 'vocab:00139', control: 'positive', preflight: true, instruction: '現在のVocabulary TARGETを最後まで話してStop。実ゲームでも同じカードを発話し、画面とSRSを比較する。', expected: '認識候補にTARGETがあればTARGET判定。一度の確定でSRS更新は最大一度。' },
  { id: 'D02', title: 'Vocabulary 下位N-best救済', fixture: 'vocab:00437', control: 'positive', preflight: true, instruction: '正しいTARGETを発話し、1位が誤認識・下位候補にTARGETが入った試行を探す。実ゲームで候補の順位と救済を確認する。', expected: '下位候補に厳密TARGETが存在する場合に正規authorityで救済。候補がなければINCONCLUSIVE。' },
  { id: 'D03', title: 'Vocabulary 重要語句の欠落', fixture: 'vocab:00139', control: 'chunk丸ごと抜け', preflight: true, instruction: 'TARGETの重要な語句・chunkを意図的に省いて話す。発話内容欄には実際に言った文を入力する。', expected: '不足したTARGETを誤って採用しない。音声認識誤差と採点誤りを区別する。' },
  { id: 'D04', title: 'Vocabulary 語順入れ替え', fixture: 'vocab:00139', control: 'chunk順序入れ替え', preflight: true, instruction: 'TARGETのchunk順序を意図的に入れ替える。発話内容欄には実際に言った文を入力する。', expected: '許可済みの表現でない限りTARGETにしない。' },
  { id: 'D05', title: 'Read 正しい全文', instruction: '通常ゲームのReadで英文全体を話す。手動停止と自動停止を確認する。', expected: '採点・一致率・ハイライト・保存SRSが一致する。' },
  { id: 'D06', title: 'Read 内容語の欠落', instruction: '通常Readの英文から内容語を一つ省いて話す。', expected: '既存Read基準どおり減点され、最終画面と保存結果が一致する。' },
  { id: 'D07', title: 'Cloze 正しい言い直し', instruction: 'Clozeの英文を途中で間違えた後、全文を正しく言い直す。', expected: '最終的な完全再現を採点し、repair区間・一致率・ハイライトが一致する。' },
  { id: 'D08', title: 'Cloze 不完全な最終言い直し', instruction: 'Clozeで一度発話してから言い直し、最後の重要部分を省いて終了する。', expected: '直前の放棄した発話で欠落部分を補完せずFAIL。' },
  { id: 'D09', title: 'Cloze 隠し語句・文中末尾欠落', instruction: 'Clozeの隠しTARGET、または文中・末尾の重要フレーズを抜く。', expected: '重要部分の欠落はFAIL。missing/blocking spanに理由を記録する。' },
  { id: 'D10', title: 'Cloze 否定表現の欠落', instruction: 'Clozeでnot / neverなどの否定表現を省いて発話する。', expected: '意味を反転させる欠落をFAILとする。' },
  { id: 'D11', title: 'Read / Vocabulary Correction', instruction: 'わざとMISSした後、Correctionで誤答→正答を試す。両モードで確認する。', expected: 'Correctionが完了し、修正練習による余分なSRS更新がない。' },
  { id: 'D12', title: 'manualStop / autoStop・エラー', fixture: 'vocab:00437', control: 'positive', preflight: true, instruction: '手動Stop、自動終了、Cancel、遅延finalなどを別attemptで比較する。', expected: 'terminal後だけ採点し、二重採点・二重SRS更新・stale callback混入がない。' },
  { id: 'D13', title: 'SRS保存・再試行・重複防止', instruction: '通常ゲームで正解・確定MISS・再試行を行い、保存前後のlevelや更新回数を確認する。', expected: '保存状態と画面が一致し、1回の確定結果で更新が重複しない。' },
  { id: 'D14', title: '診断ON/OFF・プライバシー', instruction: '通常ゲームでTrace OFF→ON、最新JSON/伏字JSONコピー、通常起動で非表示、release隔離を確認する。', expected: '伏字JSONに発話全文がなく、Trace OFFで収集停止。' },
]);

export function acceptanceCase(id) {
  return ASR_08D_CASES.find(item => item.id === id) ?? ASR_08D_CASES[0];
}
