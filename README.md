# English PWA

例文の音読・穴あきチャレンジ・並べ替えや語彙の練習を続ける英語学習アプリです。学習結果から復習時期を決め、例文の習熟度からキャラクターとの関係を計算します。

## 起動とビルド

Node.js 22 で依存関係をインストールし、Web 配信物を作ります。

```sh
npm ci
npm run web:stage
python3 -m http.server 8000 --directory web-dist
```

ブラウザで [http://localhost:8000/](http://localhost:8000/) を開きます。配信時は `web-dist/` を静的ホスティングの公開ディレクトリに指定します。manifest、Service Worker、教材、画像は相対パスで解決されるため、ドメイン直下やサブディレクトリで配信できます。初回オンラインで Service Worker のキャッシュが作成されると、教材とキャラクター画像を含めてオフラインで起動できます。音声認識と読み上げのオフライン可否は端末のプロバイダーに依存します。

Android は JDK 21 と Android SDK 36 を使います。

```sh
npm run native:sync
./android/gradlew -p android assembleDebug assembleRelease lintDebug
```

Capacitor は `native-web/` を Android のアセットへ同期します。ブラウザと Android で学習ロジックを共用し、音声認識・TTS・音源フォルダ・バックアップのファイル保存にはそれぞれの実行環境の API を使います。Android の診断手順は [Android の音声と検証](docs/android-native-speech.md) を参照してください。

## 構成

| 場所 | 責務 |
| --- | --- |
| `index.html`、`styles/`、`scripts/app/` | ホーム、キャラクター選択、学習セッション、設定。起動時に中断された復元を先に復旧 |
| `scripts/app/levelState.js`、`scripts/state/studyLog.js` | 例文・語彙の習熟度と SRS、日別学習記録とセッション集計 |
| `scripts/app/relationshipCore.js` | 例文の状態と担当キャラクターから関係ランクと親密度を計算 |
| `scripts/speech/`、`scripts/audio/`、`scripts/reorder/` | 認識結果の確定、採点・救済、音源・TTS、並べ替え |
| `data/`、ルートのキャラクター画像、`icons/` | 教材、キャラクター、アプリアセット。教材の検証用資料は同じリポジトリで管理 |
| `scripts/build/stage-runtime.mjs` | Web と Android 共通の配信物の依存追跡。HTML・CSS・ESM と、動的に参照される教材や画像を収集 |
| `GAS/`、`tests/`、教材生成・検証スクリプト | スプレッドシートからのオフライン書き出し、教材の整備、回帰検証 |

`runtime-assets.json` は Web ステージングと Service Worker が使う生成済みの配信ファイル一覧です。実行ファイルや画像を追加・移動した場合は `npm run web:manifest` で更新してください。アプリをリリースする際は `APP_VERSION` と連動する URL のバージョンを更新し、一覧を再生成します。Web 配信物と Android アセットは、いずれも依存追跡の対象だけをコピーします。

## 教材を更新する

| 教材 | 正本・生成元 | 更新後に確認するもの |
| --- | --- | --- |
| 例文 560 件 | `data/items.json`。既存の `E…` ID を維持し、新規例文に未使用の ID を割り当てる | `data/characters.json` の話者 ID と照合。語彙の出典・出現箇所も検証 |
| 語彙 2,478 件 | `data/vocabulary-v3.json`。語義単位の `vocab:…` ID と例文 ID による出典を維持 | `npm run vocab:sync-derived` でレポートと派生インベントリを更新し、`npm run vocab:validate` を実行 |
| キャラクター 20 人 | `data/characters.json` と名前に対応するルートの PNG | `node scripts/tagging/validate-characters.mjs` |
| 並べ替え | 例文、`data/sentence-pattern-analysis.json`、`data/reorder-overrides.json` | `python scripts/reorder/generate-reorder-metadata.py` で `data/reorder-v1.json` とレポートを生成し、Node と Python の並べ替え検証を実行 |

例文の構文解析やタグ整備には `scripts/tagging/` の生成ツールを使います。Python の並べ替え検証・生成には CI と同じ spaCy 3.8.16 と `en_core_web_sm` を使います。語彙の旧データ、確定済みの語義・出典の監査資料、`vocabulary-v2-v3-migration.json` は、現行の検証や旧端末の学習状態の引き継ぎを支えます。教材を増やす際は、既存 ID を別の意味に再利用せず、旧教材件数を固定した検証の対象範囲も確認してください。

## 学習データの保存と復元

学習を終了してホームに戻り、**設定 → 学習データ** から JSON を保存または復元します。操作中は、同じ配信先で開いている他の English PWA タブを閉じてください。復元前に、保存日時・教材版・データ件数・未収録 ID 数と、現在の学習状態が置き換わることを確認できます。

バックアップ形式 v1 は、アプリバージョン・作成日時・教材ファイルの SHA-256 と、端末に永続化された次のデータを保持します。

- 例文と語彙の習熟度、正誤の集計、SRS と復習日時、日別履歴と保存済みセッション集計
- キャラクターの関係を計算する学習状態、達成済みマイルストーン、直近のキャラクター
- 直近の出題 ID、語彙ローテーション、学習方法、再生速度、学習目標、通知済み状態、移行マーカー

復元は既存データを退避してから置換し、処理が中断した場合は次の起動時に復旧します。未収録の教材記録は保存された ID を維持し、現行教材に復活した際に引き継げます。既存の語彙 ID 移行は従来の規則に従います。関係ランクや親密度は復元後に再計算されます。

実行中のセッション、画面の一時状態、キャッシュ、旧 API 設定や認証情報はバックアップの対象外です。音源フォルダの権限はブラウザの IndexedDB または Android の端末設定に保存されます。音源ファイルは別途コピーし、移行先でフォルダを選択してください。Android 版の JSON 保存にはシステムのファイル選択画面を使います。

## テストとリリース

```sh
npx playwright install chromium
npm test
npm run vocab:validate
node scripts/reorder/validate-reorder-metadata.mjs
python scripts/reorder/validate-reorder-gold.py
```

GitHub Actions はブラウザ回帰、教材・発話採点の検証、Android debug/release ビルド・Lint と API 35 エミュレーター試験を実行します。教材変更時は派生物と検証結果を確認し、Web の `web-dist/` と Android のビルドを同じコミットから作成してください。完了済みの作業経緯と旧検証資料は Git 履歴・Issue・PR を参照してください。
