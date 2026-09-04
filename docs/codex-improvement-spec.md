# english-pwa：連絡先 / 虫食い / 例文品質 / キャラクター紹介 改善

## 目的

以下の5点をまとめて改善してください。

1. 「連絡先」を開いたのにトレーニング一覧が表示されることがある問題を修正
2. 起動時にNickが選ばれる率が高く見える件を確認。ただし現行の学習優先推薦が正常なら変更しない
3. 虫食い問題の品質と認知負荷を改善し、重要語・重要表現を複数回の遭遇でローテーションして学べるようにする
4. 文頭が不正に小文字になっている英文データを修正し、再発を防止
5. キャラクター紹介をゲームらしい文章へ刷新し、性格タグの直接表示を廃止

今回は大規模なUI再設計ではありません。

既存の学習フロー、発話判定、レベル判定、親密度、TTS、キャラクターキャスティング等は維持してください。

---

# 作業開始時

必ず最新 `main` を基準にしてください。

最初に読む範囲は原則として以下だけで十分です。

- `scripts/app/tagBrowser.js`
- `scripts/app/relationshipMode.js`
- `scripts/app/relationshipCore.js`
- `scripts/app/clozeMode.js`
- `scripts/app/clozeLearningCore.js`
- `data/characters.json`
- `tests/clozeLearningCore.test.mjs`
- `tests/friendshipUiModules.test.mjs`
- `tests/datasetDialoguePunctuation.test.mjs`

必要になった場合のみ周辺ファイルを追加で読んでください。

### 読まなくてよいもの

- Git履歴
- 過去バージョン
- 全音声関連コード
- キャラクターTTS実装
- ASR内部
- 関係ないUI
- `items.json` 全文の目視読込

`data/items.json` を調査するときは、Node等で機械走査してください。560文をコンテキストへ展開して目視確認しないでください。

`characters.json` についても紹介文作成時に主に使うのは、

- `name`
- `archetype_ja`
- `summary_ja`
- `traits`
- `relationships`

です。

巨大な `source_item_ids` や全evidenceを逐一読む必要はありません。矛盾確認が必要な場合だけ参照してください。

---

# Task 1：連絡先を開くとトレーニング一覧になる問題

## 原因

現在 `tagBrowser.js` では、

1. `openBrowser('character')` 等で `state.activeType` を設定
2. 初回ロード時の `ensureData()`
3. `learningBrowserTabV2` の保存タブを読み込んで `state.activeType` を上書き

という順序になる可能性があります。

そのため、以前「トレーニング」を開いていた端末で初回に「連絡先」を開くと、明示的に `character` を指定しても保存状態の `skill` が勝つことがあります。

これは修正してください。

## 仕様

明示的な入口指定を、保存された前回タブより必ず優先してください。

### 連絡先

`openBrowser('character')`

なら必ず、

- `activeType = character`
- `characterOnly = true`
- 連絡先一覧

から開始する。

以前の `learningBrowserTabV2` が `skill` でも絶対に影響させない。

### トレーニング

`openBrowser('skill')`

なら必ず、

- `activeType = skill`
- `characterOnly = false`
- トレーニング一覧

から開始する。

### 統合ブラウザ

明示的typeがない「連絡先・トレーニング」入口についてのみ、

- 保存された前回タブが有効なら復元
- 保存値がなければ `character`

として構いません。

## 実装方針

大規模なブラウザ分割は不要です。

現在の共通ブラウザを維持しつつ、

**requested type > saved type > default**

という優先順位を明示してください。

可能なら判定部分を小さなpure functionへ切り出し、DOMなしでテストしてください。

## 必須テスト

最低限以下を固定してください。

- requested=`character`, saved=`skill` → `character`
- requested=`skill`, saved=`character` → `skill`
- requested未指定, saved=`skill` → `skill`
- requested未指定, saved値なし → `character`

また、

**「連絡先」入口からトレーニングタブが見える状態にならないこと**

も既存 `friendshipUiModules.test.mjs` 等で回帰防止してください。

---

# Task 2：起動時Nick率

## 結論

今回、Nick専用の補正やキャラクター推薦アルゴリズムの再設計はしないでください。

現行 `recommendCharacter()` は単純ランダムではなく、

- 復習期限
- 学習途中か
- 未開拓キャラか
- 次ランクへの近さ
- 親密度低下
- main/supporting tier
- 最近会ったキャラクター

等から「今日の相手」を選んでいます。

したがって同じ学習状態で同じキャラクターが何度も推薦されること自体は異常ではありません。

キャラクター総担当数でもNickだけが突出しているわけではないため、ユーザーの学習状態による推薦であれば許容します。

## やること

`recommendCharacter()` に、

- `nick`
- `Nick`

を直接優遇する条件がないことだけ確認してください。

もし存在しなければ推薦ロジックは変更しないでください。

今回ここにランダム性を追加したり、Nickだけ減点したりしないでください。

既存のrecent-character rotationも維持してください。

## 回帰テスト

既存 `relationshipCore` テストが通れば基本的に十分です。

今回の他修正によって推薦ロジックへ影響を与えないことだけ確認してください。

---

# Task 3：虫食いアルゴリズム刷新

ここが今回の主要変更です。

現在の基本設計、

- `vocabulary-v2.json` の重要語・表現を使う
- phraseを重視する
- 学習レベルによって1〜3グループ
- 重複spanを除外する

は維持してください。

ただし現在は、

- 同じ文ならほぼ毎回同じ箇所
- 「空欄グループ数」しか認知負荷として見ていない
- 長いphrase × 複数空欄で文の大部分が消える場合がある
- fallbackの学習価値が弱い場合がある

という問題があります。

---

## 3-1. ランダムではなく「高品質候補のローテーション」

重要なのは完全ランダム化ではありません。

以下の順序にしてください。

**候補抽出  
→ 品質評価  
→ 認知負荷制約  
→ 最近使っていない候補を優先  
→ 同等候補の中だけ変化を付ける**

低品質な単語まで無差別にランダム選択しないでください。

---

# 遭遇中は絶対に変えない

同一カードを表示中に、

- DOM再描画
- MutationObserver
- ヒント段階変更
- スワイプ
- ASR表示更新

などが発生しても、虫食い位置を変えないでください。

ユーザーが同じ問題を見ている最中に空欄が移動するのは不可です。

`clozeMode.js` 側で、

**現在のitem encounterに対するvariant**

を保持してください。

itemが別のitemへ切り替わるまでは同じvariantを使ってください。

---

# 次回遭遇時は変化させる

一度別カードへ進み、その後また同じitemへ遭遇した場合は、

可能なら前回とは異なる重要語・重要表現を優先してください。

永続的な「習得履歴」にはしません。

虫食いターゲット履歴はあくまで表示ローテーションです。

### 推奨

アプリ実行中だけ、

`itemId -> 最近使ったtarget signature / entry_id`

を少数保持する。

1 itemにつき直近2パターン程度で十分です。

これを正式な学習進捗としてlocalStorageへ大量保存する必要はありません。

ページ再読込後に履歴が消えても問題ありません。

---

# 3-2. 重要表現を一巡させる

候補が複数ある場合、

直近で隠した `entry_id` より、

**まだ隠していない高品質候補**

を優先してください。

例：

対象文に、

- take it easy
- assure
- turn out

がある場合、

毎回 `take it easy + turn out`

固定ではなく、

複数回の遭遇によって `assure` も自然に虫食いになるようにしてください。

ただし低品質候補を採るために、高品質候補を捨てる必要はありません。

「候補の質」と「未使用」を両方考慮してください。

---

# 3-3. 候補品質

既存の、

- vocabulary entry
- `match_confidence`
- `meaning_confidence`
- phrase / word
- example linkage

を利用してください。

大まかな優先順位は、

### Tier A
例文との対応が強い重要語・重要表現

- linked example
- high match confidence
- aligned_high / aligned_medium

### Tier B
例文に紐付いた妥当な語彙・表現

### Tier C
リンクはあるが確信度が弱い候補

### fallback
usableなvocabulary候補がない場合のみ

としてください。

Tier A/Bが十分あるのにfallbackを採用しないでください。

---

# 3-4. 空欄数だけでなく「隠れる総語数」を制限

`adaptiveClozeCount()` は今後、

**最大空欄グループ数**

として扱って構いません。

「必ずその個数を作る」という意味にはしないでください。

総隠し語数のbudgetを追加してください。

## soft budget

英文alphabetic token数を `N` として、

### Lv0–1
最大1グループ  
目安：全文の約22%まで

### Lv2
最大2グループ  
目安：全文の約28%まで

### Lv3–5
最大3グループ  
目安：全文の約34%まで

`floor` 等で実装して構いませんが、最低1語は隠せるようにしてください。

---

# hard limit

通常は全文の40%を超えて隠さないでください。

また、空欄化後も最低2つ程度のalphabetic tokenが残るようにしてください。

---

# 重要phraseの例外

重要熟語を分割すると学習価値が落ちる場合があります。

例：

`turn the light out`

は、

`turn ____ out`

ではなくまとまったspanとして扱う現在の設計を維持してください。

以下をすべて満たす重要phraseならsoft budget超過を許容できます。

- vocabulary由来
- 高品質候補
- 最大4 tokens程度
- 元文が8 tokens以上
- 最終的なhidden ratioが45%以下

この例外を使った場合、そのphraseだけで十分な負荷なら追加空欄を作らないでください。

---

# 3-5. 長い空欄を複数並べない

次のような状態は避けてください。

`____ ____ ____ ____ ... ____ ____ ... ____`

重要phraseが長い場合は、

**長い1箇所 + 他は表示**

を優先します。

グループ数最大値より認知負荷budgetを優先してください。

---

# 3-6. fallback改善

vocabulary linkageがない場合も、基本的には1語だけ有用なcontent wordを隠してください。

優先：

- content word
- 3文字以上
- function wordではない
- 代名詞ではない
- obvious proper nounではない
- 文中の意味推測に使える語

避ける：

- a / the / of等
- I / you等
- 人名
- 最初に見つかっただけの単語

現在の「長い単語を優先」だけより少し意味的に妥当なfallbackにしてください。

ただしfallback用に新しい巨大辞書やNLPライブラリを導入しないでください。

---

# 3-7. variation

テスト可能にするため、pure core側には必要なら、

- `variantKey`
- `seed`
- recent target ids

等を引数として注入できるようにしてください。

runtime側のvariant生成には小さな乱数で構いません。

ただし同一encounter中は固定してください。

テスト内で `Math.random()` の偶然に依存しない設計にしてください。

---

# 3-8. 必須unit tests

既存 `tests/clozeLearningCore.test.mjs` を更新してください。

最低限：

### 基本

- sentence reconstructionが完全一致
- target同士がoverlapしない
- phraseが適切に1spanになる
- split phrasal verbの既存挙動を維持

### 負荷

- Lv0–1は最大1group
- Lv2は最大2group
- Lv3–5は最大3group
- 通常ケースで40%超を隠さない
- 長いphrase例外でも45%超にならない
- 長いphraseを採ったためbudget不足なら無理に空欄数を満たさない

### variation

2個以上の有効候補を持つ文について、

複数variantを生成した場合に少なくとも2種類のtarget構成が得られること。

ただし、

同一variantKeyでは常に同じ結果になること。

### quality

高品質vocabulary候補が存在する場合にfallbackへ落ちないこと。

### fallback

vocabulary linkageがなくても、

- function wordだけを選ばない
- usableなcontent wordなら1語を選べる

こと。

---

# 3-9. dataset-wide audit

ここだけは実データ全体を使ったテストを実行してください。

560文を人間が読む必要はありません。

Node scriptまたはtestで機械的に、

全items × 代表レベル

- Lv0
- Lv2
- Lv5

について複数variantを生成し、以下を検査してください。

## hard failure

- overlap
- sentence reconstruction failure
- token範囲外
- 通常hidden ratio > 40%
- phrase例外 > 45%
- 全文またはほぼ全文が消える
- 0語文などの例外でクラッシュ

## summaryとして確認

- fallback使用item数
- 最大hidden ratio
- 平均hidden ratio
- 複数候補を持つitem数
- そのうちvariantが実際に複数生成できたitem数
- 1/2/3 groupの分布

このsummaryはコンソール出力で構いません。

生成report JSONを恒久的にcommitする必要はありません。

極端な値が出た場合だけ該当itemを確認してください。

全560文を目視レビューしないでください。

---

# Task 4：英文文頭の小文字を修正

表示時にcapitalizeする処理は追加しないでください。

canonical sourceである、

`data/items.json`

を修正してください。

理由：

- TTS
- ASR
- 一致判定
- token位置
- 全文表示

など複数機能が同じ英文を使うためです。

---

# 4-1. 機械監査

まずscript/testで全itemを走査してください。

最低限、

先頭の、

- `"`
- `'`
- `(`
- `[`

等のopening punctuationを飛ばした後、

最初のalphabetic characterが不自然に `[a-z]`

になっているitemを抽出してください。

抽出した候補だけを確認してください。

---

# 4-2. 修正

単純な `toUpperCase()` を全データへ適用しないでください。

例えば、

- iPhone
- eBay

等の意図的なlowercase固有表記が理論上存在し得ます。

候補一覧を作り、明らかな誤りだけcanonical dataを修正してください。

現データで該当が数件なら個別修正で構いません。

---

# 4-3. 文中の新しい文

追加のsoft auditとして、

`.`
`?`
`!`

の後に続く新しい英文が明らかに小文字開始している候補も抽出してください。

ただし、

- abbreviation
- quotation structure
- 固有表記

の誤検知があり得るため、こちらは自動capitalizeしないでください。

明らかなデータ不良だけ直してください。

---

# 4-4. 回帰テスト

新規testを作るか、

`tests/datasetDialoguePunctuation.test.mjs`

へ追加してください。

少なくとも、

**item.enの先頭英文が不正なlowercaseから開始しない**

ことをdataset invariantとしてテストしてください。

既知例外がもし存在するなら、小さな明示allowlistにしてください。

巨大な例外リストでテストを骨抜きにしないでください。

---

# Task 5：キャラクター紹介文刷新

現在の、

- `archetype_ja`
- `summary_ja`
- `traits`
- `relationships`
- certainty
- evidence

は、キャラクター設定の内部データとして価値があります。

これらは削除しないでください。

ただしユーザー向け表示文としては硬すぎます。

---

# 5-1. 新しい表示専用フィールド

各キャラクターに、

`intro_ja`

を追加してください。

`intro_ja` がゲーム画面の正式な人物紹介になります。

既存の、

- `archetype_ja`
- `summary_ja`

は内部資料として残してください。

---

# 5-2. 文体

人物紹介は研究レポートではなく、

**「この人物と会話してみたくなるゲーム内プロフィール」**

にしてください。

### 基本

- 2〜4文程度
- 短め
- 日本語として自然
- 少しユーモア
- 少し誇張してよい
- キャラクター間の関係も活用
- 「〜と明示されている」「〜と推測される」等の資料的表現は禁止
- traitsの単なる列挙は禁止
- 「人物」「キャラクター」等の説明語を毎回付けない

---

# 5-3. 妄想の扱い

原典で確定していない空白部分は、ゲームらしい解釈で補って構いません。

ただし、

**既存データと明確に矛盾する新設定を作らない**

こと。

特に、

- 配偶関係
- 明示された恋愛関係
- 職業
- 明示的な行動
- 強く根拠のある性格

を逆転させないでください。

細部の生活感、語り口、オチなどは自由に補完して構いません。

---

# 5-4. 文体例

方向性の例です。そのまま固定文として使う必要はありません。

### Bob

現在のような、

「善人寄りだが不器用で、恋愛や対人関係で空回りしやすい人物」

ではなく、

「正直に生きればいつか報われる、とかなり本気で信じている。問題は、仕事でも恋愛でもその『いつか』がなかなか来ないこと。Jenniferの話になると判断力がだいたい落ちる。」

くらいの温度感。

### Nick

「頭は回るが打算的で権威的な人物」

ではなく、

「仕事では抜け目なく、上司が来ると急に働き者になるタイプ。迷信は鼻で笑う合理主義者だが、家庭の問題までは理屈で解けていない。Lisaとは今日もたぶん何かある。」

くらい。

これらの方向性を全キャラクターへ適用してください。

全員を同じジョーク構造にしないでください。

---

# 5-5. 性格タグをユーザーへ表示しない

現在のcharacter detailには、

`traits`

と会話themeをまとめた、

「性格・会話テーマ」

のchip表示があります。

このうち**性格タグは完全に非表示**にしてください。

今回UIを簡潔にするため、

「性格・会話テーマ」のchip section自体を削除して構いません。

traits/themeデータそのものは削除しないでください。

検索、キャスティング、内部ロジック等で今後利用できます。

---

# 5-6. 人物紹介UI

character detailでは、

現在の、

- archetype
- summary

の二段表示ではなく、

`intro_ja`

を人物紹介として表示してください。

例えば、

**人物紹介**

`intro_ja`

のみで十分です。

プロフィール画面をデータベース表示のようにしないでください。

以下は維持して構いません。

- キャラ画像
- 名前
- 関係ランク
- 親密度
- 学習進捗
- 次の関係目標
- 「〜と遊ぶ」

今回はプロフィール画面全体の大規模レイアウト変更までは不要です。

---

# 5-7. validation

`characters.json` のvalidatorがあるため、schema変更に合わせて必要なら更新してください。

最低限、

全表示対象キャラクターに非空の `intro_ja`

があることをチェックしてください。

traits等の既存validationは維持してください。

---

# 5-8. UI test

既存 `tests/friendshipUiModules.test.mjs` を更新してください。

現在テストに、

- `人物紹介`
- `性格・会話テーマ`

等の文字列チェックがあります。

新仕様では、

- 人物紹介が残る
- `intro_ja` を使う
- 性格タグchipを表示しない
- `性格・会話テーマ` を表示しない

ことを確認するテストへ更新してください。

---

# 不要な変更

今回は以下を変更しないでください。

- TTSプロファイル
- characterごとのvoice / pitch / rate
- speaker casting
- 発話判定
- microphone
- continuous shadowing
- 学習レベル判定
- friendship rank条件
- 親密度計算
- セッション終了画面
- キャラクター画像
- vocabulary DBそのものの大規模再生成
- 全例文の英作文リライト

虫食い品質改善のために `vocabulary-v2.json` 全体を書き換える必要もありません。

---

# 実装上の優先順位

以下の順で進めてください。

1. 連絡先 / トレーニング状態漏れ修正
2. 虫食いcore
3. 虫食いruntime variant固定
4. 虫食いunit test
5. dataset-wide cloze audit
6. 英文capitalization audit → 該当data修正 → invariant test
7. `intro_ja` 追加
8. キャラクターdetail表示変更
9. character validation / UI test
10. 全関連テスト

Nick推薦については確認だけ行い、問題がなければコード変更しないでください。

---

# 最終テスト

最低限以下を実行してください。

- `tests/clozeLearningCore.test.mjs`
- `tests/hintProgressionCore.test.mjs`
- `tests/friendshipUiModules.test.mjs`
- `tests/relationshipCore.test.mjs`
- `tests/relationshipGameData.test.mjs`
- `tests/tagDataset.test.mjs`
- `tests/datasetDialoguePunctuation.test.mjs`
- character validation関連テスト
- 今回追加したdataset-wide cloze audit

リポジトリに既存の一括テスト手段があれば、最後にそれも実行してください。

新規失敗だけでなく既存テストの意図を壊していないことを確認してください。

---

# 受入条件

## 連絡先

- 「連絡先」を押せば必ず連絡先
- 以前見ていたトレーニングtabに引っ張られない
- 「トレーニング」はトレーニング
- 統合入口だけ前回tabを復元可能

## Nick

- Nick専用優遇なし
- 現行の学習優先推薦は維持
- 正常なら変更しない

## 虫食い

- 毎回同じ場所だけではない
- 重要語・重要表現を複数回でローテーションできる
- 一度表示したカードの途中で空欄位置が変わらない
- 長文でも隠れすぎない
- 最大空欄数より認知負荷budgetを優先
- 重要な長いphraseは途中で不自然に切らない
- fallback品質が悪化しない
- 全dataset auditでhard constraint違反なし

## 英文データ

- 明らかな文頭小文字をcanonical dataで修正
- UI側capitalizeで誤魔化さない
- future regression testあり

## キャラクター

- 全キャラにゲーム向け `intro_ja`
- 不確定部分は適度にゲーム的解釈を入れてよい
- 既知設定とは矛盾しない
- traitsは内部データとして保持
- 性格タグは画面へ表示しない
- archetype/summaryの資料文をそのままユーザーへ見せない

---

# 最後の報告

実装完了後は長い説明は不要です。

以下だけ報告してください。

1. 変更ファイル
2. capitalization監査で実際に修正したitem ID
3. cloze全件auditの主要数値
   - fallback数
   - max hidden ratio
   - variation可能item数
4. 実行したテストと結果
5. 仕様から逸脱した点があればその理由

問題がなければ実装・テスト完了まで進めてください。

仕様の再提案や、実装前の一般論の説明は不要です。
