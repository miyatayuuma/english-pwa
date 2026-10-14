# Issue #210 Integrated Production Acceptance Audit

監査日: 2026-10-14 (UTC)

対象: `miyatayuuma/english-pwa`、最新 `main`

監査種別: production code を変更しない統合受入監査

## 判定

**INTEGRATION AUDIT COMPLETE / REMEDIATION REQUIRED / PHYSICAL_DEVICE_VISUAL_ACCEPTANCE_PENDING**

最新 `main` の6機能を照合し、対象ユニットテスト、GitHub CI、Chromiumモバイル表示を確認した。P2のホーム導線統合不整合を独立Issue [#337](https://github.com/miyatayuuma/english-pwa/issues/337) に記録したため、親Issue #210はOPENのままにする。Pixel実機の視覚受入もユーザー確認待ちである。

監査ブランチで追加したものは本レポートとスクリーンショットのみ。production code、学習データ、LocalStorage、SRSは変更していない。

## 1. Current GitHub Authority

| 項目 | 監査時の値 |
|---|---|
| Repository | [`miyatayuuma/english-pwa`](https://github.com/miyatayuuma/english-pwa) |
| `main` SHA | `d04ba03823d14a62d97f1186c9de7c349c75381a` |
| `APP_VERSION` | `v5.108` |
| Final runtime code SHA | `76101569b73a9ffd964028a9ba75c7a4db0d4c92` |
| Parent Issue #210 | OPEN |
| Child Issues #204–#209 | すべてCLOSED |
| Open PR #323 | Pixel ASR-08D |
| Android Gate A root cause / ASR targeted remediation | CLOSED |

`76101569` から現在の `main` までの差分はAndroid Gate AとASR remediationのvalidation文書2件のみ。アプリコード、テスト、教材、保存データの差分はない。

保護対象のデータauthorityも指定値と一致した。

| ファイル | 現在のblob SHA | 指定値との照合 |
|---|---|---|
| `data/vocabulary-v3.json` | `91324d35b2db1911ece2cf3ff746409d321fe963` | 一致 |
| `data/items.json` | `ae2aca768b784199b77ac1cf8c0c5a80fd5725bb` | 一致 |

GitHub Pagesの最新 `main` デプロイはrun [38511902983](https://github.com/miyatayuuma/english-pwa/actions/runs/38511902983) で成功し、deployment sourceは `d04ba038`。live URLも開き、`v5.108` のキャラロビーを確認した。モバイル画像は同一SHAのローカル静的配信で取得した。

## 2. Child Issue Closure Verification

| Issue | Closure / implementation PR | 最新mainの実装照合 | 監査結果 |
|---|---|---|---|
| [#204](https://github.com/miyatayuuma/english-pwa/issues/204) | CLOSED / [#211](https://github.com/miyatayuuma/english-pwa/pull/211), merge `f279c0e` | `relationshipCore.js`, `relationshipMode.js`; rank cap とsnapshot比較が現行 | コード・対象回帰PASS、全画面実値比較はPARTIAL |
| [#205](https://github.com/miyatayuuma/english-pwa/issues/205) | CLOSED / [#212](https://github.com/miyatayuuma/english-pwa/pull/212), merge `a2944a4` | `adaptiveLearning.js`, `sessionOptionsCore.js`, `sessionShell.js`; v2 plannerが現行 | PASS |
| [#206](https://github.com/miyatayuuma/english-pwa/issues/206) | CLOSED / [#213](https://github.com/miyatayuuma/english-pwa/pull/213), merge `abb8e02` | AND filter、0件理由、one-session pending stateが現行 | 条件絞り込みPASS、全lifecycleブラウザ検証はPARTIAL |
| [#207](https://github.com/miyatayuuma/english-pwa/issues/207) | CLOSED / [#214](https://github.com/miyatayuuma/english-pwa/pull/214), merge `32d33e2` | `relationshipMode.js` と `learningMenu.js` のホーム統合を照合 | PARTIAL、ナビ初期化順のP2 finding #337 |
| [#208](https://github.com/miyatayuuma/english-pwa/issues/208) | CLOSED / [#215](https://github.com/miyatayuuma/english-pwa/pull/215), merge `d34b0cc` | `sessionShell.js` の会話scene、hint、speaker castを現行mainで確認 | UI表示PASS、実音声・マイク受入はNOT_VERIFIED |
| [#209](https://github.com/miyatayuuma/english-pwa/issues/209) | CLOSED / [#216](https://github.com/miyatayuuma/english-pwa/pull/216), merge `8d3c71c` | `relationshipMode.js` のresult builder/renderと `sessionShell.js` の結果viewを照合 | model回帰PASS、採点から結果までの実セッションはNOT_VERIFIED |

各PRはmergedであり、PR本文の実装・テスト記録と最新mainの対象モジュールを照合した。IssueがCLOSEDであることだけを合格根拠にはしていない。#207を含む後続の変更は現在のmainに含まれている。

## 3. Implementation-to-Issue Mapping

| 機能 | Authority / entry point | 主な回帰証拠 |
|---|---|---|
| #204 relationship | `scripts/app/relationshipCore.js` の `buildCharacterRelationship`, `buildRelationshipCatalog`, `compareRelationshipSnapshots` | `tests/relationshipCore.test.mjs`, `tests/relationshipGameData.test.mjs` |
| #205 planning | `scripts/app/adaptiveLearning.js` の `buildAutomaticSession` | `tests/adaptiveLearning.test.mjs` |
| #206 options | `scripts/app/sessionOptionsCore.js`, `scripts/app/sessionShell.js` の options submit / reset | `tests/sessionOptionsCore.test.mjs`, `tests/zeroSetup.browser.test.mjs` |
| #207 lobby | `scripts/app/relationshipMode.js` の `renderHome`, `scripts/app/learningMenu.js` | `tests/friendshipUiModules.test.mjs` |
| #208 conversation | `scripts/app/sessionShell.js` の `renderConversationScene`, hint / control wiring | `tests/sessionShell.test.mjs`, speech browser/regression suites |
| #209 results | `scripts/app/relationshipMode.js` の `buildExchangeResult`, `renderReviewSummary` | `tests/exchangeResultUi.test.mjs` |

旧Section filterや旧QUEUEが新しい通常開始へ混入しないguardは `tests/runtimeLegacyCleanup.test.mjs` と `tests/sessionOptionsCore.test.mjs` に残っている。

## 4. Relationship Authority (#204)

現行mainのrelationship rankは既存習熟データから導出され、intimacy capは知り合い24、顔なじみ49、友達69、仲良し89、親友100。rank昇格、SRS期限超過によるintimacy decay、期限超過だけではrankを下げない動作、共有speaker差分を `relationshipCore.test.mjs` で確認した。

ホーム、連絡先一覧、会話scene、結果画面はいずれもrelationship catalog/snapshot authorityから表示値を取得する。コード上の共通authorityは確認済みだが、成功・失敗の採点を行う実セッションで4画面の同一数値を突き合わせるブラウザシナリオは完了していない。

**判定: Code PASS / Regression PASS / cross-screen integration PARTIAL.**

## 5. Automatic Session Selection (#205)

現行selectorは通常7文を基準にし、review-heavy時に8文まで拡張する。新規のみでは最大2文になり、候補数が不足する場合は実候補数へ縮小する。期限復習、弱点、最近の失敗、新規上限、最近使った例文、character/skill/section scope、interleaving、shortfall理由を固定時刻・固定データで検証した。

対象テストでは同じ入力から同じitem順・理由・構成summaryが得られ、期限復習が優先される。候補が6文未満になる条件を無条件の不具合とは扱わない。fresh local browserで通常のhero CTAを1回押し、会話sceneへ入り、計画が2文になったケースも確認した。これは新規のみの上限と一致する。

**判定: Code PASS / Regression PASS / normal-start integration PASS.**

## 6. Session Options (#206)

390×844 Chromiumで `Bob × 仮定法 × Section12` を指定すると対象0文、開始ボタンdisabled、原因解除ボタンが表示された。チャプター条件を1タップ解除すると対象2文へ戻り、開始がenabledになることを確認した。開始後のconversation progressも計画2文と一致した。

`normalizeSessionOptions` と `resetSessionOptions` の単体テストでは条件AND、0件原因、件数/mode、manual順序、ホーム復帰時はcharacterだけを残すresetを確認した。通常開始→詳細条件→終了→通常開始、更新、戻る、手動検索、旧Section、古いQUEUEの全組み合わせをブラウザで実行した証拠はない。

**判定: Code PASS / AND・0件統合 PASS / 全lifecycle PARTIAL.**

## 7. Game Lobby (#207)

同一main codeのモバイルChromium測定:

| Viewport | document width | Hero CTA | 画面内 | 結果 |
|---:|---:|---:|---|---|
| 360×844 | 360px | 306×50px | はい | レイアウトPASS |
| 390×844 | 390px | 336×54px | はい | レイアウトPASS |
| 430×844 | 430px | 376×54px | はい | P2ナビ不整合の状態を撮影 |

Bobの画像・名前・ランク・親密度、開始CTA、連絡先一覧、遊び方選択、詳細optionsへの導線を確認した。ホームにはLvやSRS期限などの内部数値は表示されない。390pxでTab移動すると歯車buttonに2px solidのfocus indicatorが出た。ページはdark schemeで表示され、`prefers-reduced-motion`を有効にした。

**Finding F-01:** `relationshipMode.renderHome()` が `#focusHomeNav` のchildrenを置き換える一方、`vocabularyMode.init()` は同じnavへ単語・表現buttonを一度だけappendする。モジュール初期化順により、430pxの記録画面ではhero CTAに加え4つのnav導線が残り、390pxでは`has-vocab-mode` classが残るのに同buttonが消えた。#207の「初期ビューポート内の主要操作3個以内」と安定したホーム導線を満たさない状態を確認した。原因・再現・受入条件は [Issue #337](https://github.com/miyatayuuma/english-pwa/issues/337) に記録済み。

**判定: Code PASS / Layout PARTIAL / Overall FAIL for #207 initial-action limit.**

## 8. Conversation Scene (#208)

390×844画面で共有会話 `Bob → Jane`、会話進行 `1/2`、日本語の発話状況、人物画像、Read/Cloze系の入力領域を確認した。hint操作で英文の一部を隠した段階へ切り替わった。音声再生、マイク、ヒントbuttonは有効状態で、それぞれ50×50、68×68、50×50pxだった。

このheadless browserでは音声合成toastが出る場合があり、実際の再生音、マイク許可、N-best順位、実話者の音声認識を受け入れたとは扱わない。Vocabulary/Read/Cloze/Correction/N-bestおよび既存のASR救済テストはApplication/Chromium CIで成功した。

characters.jsonを503にする隔離ブラウザfixtureでは、キャラprofileがない状態でも会話sceneへ進み、`💬` fallbackと教材文が表示された。保存済みユーザーデータには触れていない。

**判定: Code PASS / Visible scene PASS / speech hardware integration PARTIAL.**

## 9. Session Results (#209)

`exchangeResultUi.test.mjs` の53件対象suiteを含む回帰では、通常結果、rank-up、節目通知、共有speaker表示、詳細値の折りたたみ、アクション構成が成功した。

`session-result` 0件fixtureを使って390pxの結果UIを描画し、見出し、会話数、復習数、relationship表示、50pxの「もう少し話す」「今日はここまで」CTAを確認した。画像は視覚確認専用fixtureで、学習採点後にproduction finalizerが結果画面を出すend-to-end証拠ではない。結果画面の再表示でSRS/学習履歴が二重更新されない条件も、今回の視覚fixtureだけでは証明していない。

**判定: Result model/regression PASS / visual surface PARTIAL / scored-session integration NOT_VERIFIED.**

## 10. Cross-Feature Integration Matrix

| Scenario | 検証した主な状態 | 結果 |
|---|---|---|
| 通常開始 | home hero → 自動計画 → 会話scene | PASS; fresh datasetでは2文の新規上限表示 |
| キャラ一覧 | 連絡先を開き20キャラ・rankを描画 | PARTIAL; キャラ詳細を選び開始までの一連操作は未実行 |
| 詳細AND条件 | Bob × 仮定法 × Section12 | PASS; 0件で停止 |
| 0件復元 | 原因解除1回で2候補へ戻る | PASS |
| 成功採点 | SRS/relationship/結果を同一実セッションで比較 | NOT_VERIFIED |
| 失敗採点 | retry・SRS・relationship結果の実セッション比較 | NOT_VERIFIED |
| 共有speaker | Bob→Jane sceneのspeaker表示、relationship unit test | PARTIAL; 実採点時の両者差分は未検証 |
| 再開始と旧条件 | unit testで条件reset、browser full cycle | PARTIAL |
| 更新と保存互換 | CIのmigration/browser suite成功、localStorageは隔離fixtureのみ | PASS for CI migration case; 全負例はPARTIAL |
| profileなし | characters.json 503の隔離fixture | PASS; fallback glyphと教材表示を確認 |

`selectedCharacterId`、options、plan size、表示item、speaker順、進行表示は、0件解除から始めた2-itemセッションで照合した。結果snapshotに関わる成功/失敗の学習履歴差分はNOT_VERIFIED。

## 11. Save / SRS Integrity

- 指定のvocabulary/items data blob authorityは不変。
- relationship rank/intimacyは既存item masteryと期限状態から計算し、別通貨はない。
- relationship testsでcap、rank-up、期限超過decay、rank維持、共有speaker deltaを確認。
- session-options testsで設定のみの変更と学習結果を分離し、ホーム復帰で一時条件をresetする。
- Application/Chromium CIのexisting migration/E2E testは同一runtime SHAで成功。
- ローカルBrowserでは新規contextだけを使い、ユーザー保存値を読み書きしていない。
- 0件条件から候補のないitemを生成せず、開始disabledになる。

**全negative controlの独立した実セッション検証はNOT_VERIFIED。** とくに結果画面再表示時の二重記録防止、成功/失敗後のrelationship差分、無関係characterの値不変を手動ブラウザで完了していない。SRS authorityのコード/回帰/CIは通過したが、これらの限定条件を包括PASSとはしない。

## 12. Mobile Browser Visual Acceptance

スクリーンショットは Chromium `153.0.8010.0`、main source SHA `d04ba03823d14a62d97f1186c9de7c349c75381a`、APP_VERSION `v5.108` の静的配信、dark scheme、reduced-motion有効で取得した。すべてviewport screenshotで、DOMだけではなく画像も確認した。

| Screenshot | Viewport | 内容 / 測定 | 結果 |
|---|---:|---|---|
| [home-360.png](issue210-evidence/home-360.png) | 360×844 | hero CTA表示、横幅360px | Layout PASS; nav raceを含む一状態 |
| [home-390.png](issue210-evidence/home-390.png) | 390×844 | hero CTA表示、tab focus 2px | Layout / focus PASS; vocabulary routeなし |
| [home-430.png](issue210-evidence/home-430.png) | 430×844 | 追加の単語・表現routeがnavに残る状態 | **P2 FAIL; Issue #337** |
| [character-selection-390.png](issue210-evidence/character-selection-390.png) | 390×844 | 20人の連絡先シート | PASS; シート内scroll |
| [session-options-390.png](issue210-evidence/session-options-390.png) | 390×844 | 条件、件数、方式、トレーニング設定 | PASS |
| [zero-candidates-390.png](issue210-evidence/zero-candidates-390.png) | 390×844 | 条件0件、解除原因、開始disabled | PASS |
| [conversation-390.png](issue210-evidence/conversation-390.png) | 390×844 | Bob→Jane sceneと操作control | PARTIAL; 実音声なし |
| [conversation-hint-390.png](issue210-evidence/conversation-hint-390.png) | 390×844 | 英文ヒント段階 | PASS |
| [session-result-390-fixture.png](issue210-evidence/session-result-390-fixture.png) | 390×844 | 0件 `session-result` fixtureによる結果surface | PARTIAL; synthetic visual fixture |
| [character-data-fallback-390.png](issue210-evidence/character-data-fallback-390.png) | 390×844 | profile load 503時の会話fallback | PASS |

360/390/430で横スクロールなし、ホーム主CTAは初期画面内だった。ボタンサイズ、ダーク表示、reduced-motion、キーボードfocusを確認。実デバイスのタップ・画面サイズ・音声入出力を代替する証拠ではない。

## 13. Physical Device Acceptance

**`PHYSICAL_DEVICE_VISUAL_ACCEPTANCE_PENDING`**

Pixel端末のホームCTA、キャラ選択、詳細条件操作、音声/マイク/ヒント、画面遷移、結果表示、scroll/tap/文字サイズはユーザーによる後日確認待ち。実機スクリーンショットは未取得であり、物理端末PASSとは記録しない。

## 14. Regression and CI Evidence

| 実行 | 結果 |
|---|---|
| `npm ci` | PASS |
| `npm test` (local; repository bundled Chromium unavailable) | 605 tests: 518 pass / 0 fail / 87 skipped。Browser skipだけからUI PASSとはしない |
| 重点relationship/adaptive/options/UI/result 8 suites | 53 pass / 0 fail / 0 skip |
| `npm run vocab:check-derived` | PASS |
| `npm run vocab:validate` | PASS |
| `npm run speech:validate-td-cluster-before-to` | PASS; 36 records validated, current drift 0 |
| `npm run speech:validate-asr-09b` | PASS; 33 approved pairs, 66 directions, 37 fixtures |
| `npm run speech:validate-asr-09c` | PASS; 12 bidirectional positive controls, 31 negative controls |
| `npm run speech:validate-asr-09d` | PASS; 18/18 candidates, 23 negative controls, APP_VERSION v5.108 |
| GitHub Application / Chromium on runtime SHA `76101569` | PASS; 605 tests: 603 pass / 0 fail / 2 skipped; run [38510184939](https://github.com/miyatayuuma/english-pwa/actions/runs/38510184939) |
| GitHub Vocabulary validation on runtime SHA `76101569` | PASS; run [38510184916](https://github.com/miyatayuuma/english-pwa/actions/runs/38510184916) |
| Android Debug / Release / Lint + Android Gate A | PASS; run [38510184838](https://github.com/miyatayuuma/english-pwa/actions/runs/38510184838) |
| Pinned-source Android Gate A at exact runtime SHA `76101569` | PASS; all 3 acceptance jobs passed; run [38510777393](https://github.com/miyatayuuma/english-pwa/actions/runs/38510777393) |
| Pages build/deploy at current `main` SHA `d04ba038` | PASS; run [38511902983](https://github.com/miyatayuuma/english-pwa/actions/runs/38511902983) |

ローカルの標準Playwright browser binaryは利用できず、`npm test`では87件がskipになった。別のChromium buildで既存OPFS migration browser testを起動した際はbrowser processがSIGTRAP終了したため、そのlocal suite結果もPASS扱いしない。UI画像/操作は同Chromium `153.0.8010.0` の隔離Playwrightシナリオで別途取得した。GitHubの同一production runtime SHAのApplication/Chromium CI成功を、既存全体suiteの受入証拠に使用した。変更していない保護CIを根拠なく再実行していない。

## 15. Findings

### F-01 — P2 — [Issue #337](https://github.com/miyatayuuma/english-pwa/issues/337)

- **Related issue:** #210; home requirement #207
- **Modules:** `scripts/app/relationshipMode.js`, `scripts/app/learningMenu.js`, `scripts/app/vocabularyMode.js`
- **Reproduction:** 360–430px Chromiumで初期homeを表示し、home/vocabulary moduleのload順を変えて再読込する。430pxではvocabulary routeを含む4 routeが残る状態、390pxでは`has-vocab-mode` classだけ残ってbuttonが消えた状態を取得。
- **Expected:** 初期画面の主要操作は3個以内で、全module初期化後も導線が安定する。
- **Actual:** `relationshipMode`の`nav.replaceChildren()`と`vocabularyMode`の一度だけのappendが競合し、表示route数が初期化順に依存する。routeが残った状態ではhero CTAを含む主要操作が4個。
- **Evidence:** 上記home-430/home-390 screenshotと、PRに含む監査レポート。
- **Recommended remediation:** home navigationの所有・初期化を一箇所へ集約し、vocabulary routeをsecondary pathへ移すか、3個以内のhierarchyで統合する。修正とregression testはIssue #337で行う。

件数: P0 0 / P1 0 / P2 1。
他のNOT_VERIFIED事項は不具合と断定していない。

## 16. Closure Readiness Decision

親Issue #210は**OPENのまま**にする。

- 現行main実装、relationship/planner/options regression、既存GitHub CIは確認済み。
- モバイルUIは多くの画面で受入できたが、#207の初期操作数要件に反するP2統合finding #337が残る。
- 成功/失敗の実採点から結果表示・SRS/relationship差分までの完全なブラウザシナリオはNOT_VERIFIED。
- Pixel実機visual acceptanceは `PHYSICAL_DEVICE_VISUAL_ACCEPTANCE_PENDING`。

本監査PRはproduction codeを含まず、監査記録のためmerge可能。PRをmergeしてもIssue #210は閉じない。次のengineering taskは #337 のホームナビ統合修正とcombined-nav回帰テスト、その後のPixel実機確認である。
