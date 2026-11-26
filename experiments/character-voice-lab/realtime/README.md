# P3.6 Kokoro 会話音声ラボ

Kokoro-82M v1.0を端末内で実行する会話試験ページ。P3.5の20人を同じモデルリビジョン・voice ID・アクセント・話速で使用する。発話は自作英文を使う。試験は v5.119 と独立したページで実行する。

## Pixel 9で開く

PCに Python 3.11以上、curl、Android Platform-Tools（adb）を用意する。USBデバッグを有効にしたPixelをPCへ接続する。次のコマンドをリポジトリのルートで実行する。

```sh
git fetch origin research/p3-6-kokoro-realtime
git switch research/p3-6-kokoro-realtime
python3 experiments/character-voice-lab/realtime/prepare.py --serve
```

別の端末で以下を実行し、PixelのChromeで [http://127.0.0.1:8766/](http://127.0.0.1:8766/) を開く。

```sh
adb devices
adb reverse tcp:8766 tcp:8766
```

初回の準備でPCが固定版のモデル・音声・実行ライブラリを取得する。既定のq8パックは約125 MB。PCはローカルの静的ファイルを配信し、合成・再生・測定はPixel内で行う。端末のlocalhostを使うため、マイクの許可とWASMのスレッド利用が可能になる。USB転送は冷間の初期化時間に含まれる。PC自身でも同じURLを開ける。

q4・FP32・WebGPUを比較するときは、サーバーを停止して `--precision q8 q4 fp32 --serve` を指定する。3種類を合わせると約760 MBのダウンロードを要する。WebGPUの項目はブラウザがAPIを公開し、FP32を準備したときに選べる。実際のアダプターとモデルの実行可否は初期化時に確認する。取得済みファイルで配信だけを始める場合は `--serve-only` を使う。

## 受入測定

| 確認 | 操作と見る値 |
| --- | --- |
| 初期化・短文 | WASM/q8の1・2・4・8スレッドを順に選び、各回「モデルを準備」→「短文 × 5」→「合成して再生」。設定変更前に「モデルを解放」。初期化、初回合成、短文のウォームp50・p95、RTFを保存 |
| 逐次到着・無音 | 「4ターン」を実行。英文が約45 ms/トークンで届く。句読点で分割した7発話が順番に再生される。JSONで発話間の無音と再生中の合成回数を見る |
| 停止と割り込み | 発話中に「停止」、次に「話す・割り込む」を試す。ヘッドホンで「声で割り込む」も試し、固定試験文 `Give me a minute.` を発話する。後続の返答が再生されないこと、聞き取り中に合成を再開できないことを確認 |
| ASR | PixelのChromeでは「ブラウザ標準ASR（通信あり）」を明示選択して上と同じ固定試験文を使用。最終結果の有無とASRエラーをJSONに保存。音声はブラウザの認識サービスへ送られる場合がある。マイク検出はオフラインで使える。Chromeの `processLocally` による認識は対応デスクトップ用 |
| オフライン | q8を選び「端末に保存」。保存完了後、機内モードにしてPC側の配信も止め、同じURLを再読み込み。モデルを準備し、短文を再測定。選んだ精度のパックを保存する。ブラウザのサイトデータ消去・容量整理で再取得が必要になる場合がある |
| 連続会話 | 画面を表示したまま「10分連続会話」。着手から10分が過ぎた時点で進行中の会話を完了して止まる。エラー、欠落、前後半のRTF・無音、PSSと温度を見る |
| 音質 | 「声の比較（日常文）」で話者を選び、生成と「事前生成を試聴」を交互に聴く。「発音比較（自動／指定）」では一つ目の `read` が /rɛd/、二つ目が /riːd/ か確認。q8・FP32・必要に応じq4を同じ設定で比較 |

「結果をJSONで保存」で同じページ内の設定・試行をまとめて出力する。ASRはイベント種別、時刻、エラーだけを記録する。切断時は `adb reverse --remove tcp:8766` でポート転送を解除できる。

### 測定値の読み方

- **初期化**はWorker内でSDK・グラフを準備する時間。最初の声や音素化の準備を含む合成は、準備ボタンの「初回合成」に記録する。短文の各行に声ベクトルのウォーム状態を保存する。
- **合成要求→再生開始**はWorkerへの要求からWeb Audioの `getOutputTimestamp()` による推定出力時刻まで。取得できない端末では代替のクロックをJSONに記録する。話し声の立ち上がりはさらに `leadingMs` を加える。初回クリックからの待ち時間は `playbackAt - startedAt`、模擬ストリームの入力待ちは `synthesisRequestedAt - receivedAt` で追える。
- **RTF** は音素化と推論の時間 ÷ 再生するPCMの長さ。元の波形に対する `rawRtf` も保存する。**発話間の無音**はバッファ間の待ちと両端に残した無音の合計。語末を残すための余白は固定で最大110 ms。
- **メモリ**は取得可能な範囲でブラウザのヒープとページの集計推定を出力する。ONNXやGPUを含む端末の実測には、Chromeを閉じた状態、試験ページのみを表示した状態、モデル準備後、10分後にそれぞれ `adb shell dumpsys meminfo com.android.chrome` と `adb shell dumpsys thermalservice` を採取する。Chromeのほかのタブは閉じる。
- **音質**は同一話者の事前生成、q8、FP32の順番を入れ替えて比較する。声の識別、子音と語末、強勢、同綴異音語、文境界の間を記録する。事前生成MP3には別の音量調整とエンコードがある。

## 共通プロフィールとP6への受け渡し

- `../profiles.json` の `p35-voice-v1` をP3.5バッチと共有する。`runtime.json` はKokoroのモデルID・重みのリビジョン・SDK版・24 kHzの出力を固定する。パック生成時、20人の事前生成クリップの声・アクセント・話速・リビジョンおよびファイルハッシュを照合する。ブラウザでは起動時に同じ20人の音声IDとアクセントを照合する。
- 発話入力は `{speaker, text, kokoroPhonemes?}`。音素指定がある場合は全文のKokoro音素列として扱い、分割せずSDKの `generate_from_ids` に渡す。表示英文は保持する。P3.5のPythonとブラウザでは音素化実装が異なるので、比較対象の発音は同じ音素列と耳で確認する。
- `stream.js` は英語の文境界を優先し、長文でだけ句や空白に分ける。略称・小数・短縮形を含む公開英語で回帰を確認する。P6では話者切り替えとターン終了を明示イベントにし、LLMの入力ストリームにキャンセルを伝える。
- `worker.js` と `audio.js` はモデル常駐、最大2発話の再生先読み、世代の中断を担う。停止時に音声ノードを破棄する。合成が進行中の割り込みではWorkerを終了するため、次回の初期化が必要になる。完了済みのモデルは再利用する。聞き取りは出力バッファを排出してから開始し、ASRの終了まで次の合成を待つ。
- 声による割り込みの試験はブラウザのエコーキャンセルとマイク音量を利用する。ヘッドホン前提で、人の声と環境音は自動識別しない。割り込みを引き起こした音声の先頭を後段のASRへ引き継がない。P6のスピーカー運用は、Android側でエコーと発話前の音声バッファ、フォーカスとASRを統合したうえで受け入れる。
- 端末でウォームp50が約500 ms、RTFが1未満の設定を優先する。間に合わない端末では同一プロフィールの事前生成した短い応答と、常駐モデルによる次の文の先行生成を組み合わせる。WASMの次にAndroid ORTを試す場合はこの重み・声ベクトル・音素列と同じ条件でARM64 CPUの1/2/4スレッド、続いて対応するXNNPACKを比較する。P6には実測した設定を渡す。

## 再現用コマンド

```sh
node --test experiments/character-voice-lab/realtime/stream.test.mjs
python3 -m venv /tmp/kokoro-p36
/tmp/kokoro-p36/bin/pip install -r experiments/character-voice-lab/requirements.txt
/tmp/kokoro-p36/bin/python experiments/character-voice-lab/realtime/benchmark_native.py kokoro-realtime-site --threads 4
```

Androidのハードウェアパスは [ORT Webのスレッド条件](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)、[XNNPACK](https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html)、[AndroidのNNAPI移行ガイド](https://developer.android.com/ndk/guides/neuralnetworks/migration-guide)を参照。NNAPIはAndroid 15で非推奨。Android Chromeの端末内Web Speech認識の対応は [MDNの互換性データ](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json)を参照。
