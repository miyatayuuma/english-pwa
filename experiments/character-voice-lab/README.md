# English PWA P3.5 キャラクターボイス試聴室

**暫定候補は Kokoro-82M v1.0 ONNX。** 20人に別々の音声を割り当て、同じ英文で発音や声の違いを比較できる。教材への採否は試聴後に決定する。

## 試聴する

配布版 HTML を PC またはスマートフォンのブラウザで開く。128本のMP3と既存の肖像20枚はファイルに含まれ、保存済み音声はオフラインで再生できる。ブラウザ標準音声の種類と接続要否は端末による。Pixel 9測定を選んだ場合に限り、ランタイムとモデルを取得する。

チェックアウトから確認する場合はリポジトリのルートで `python3 -m http.server 8765` を実行し、[試聴室](http://localhost:8765/experiments/character-voice-lab/) を開く。

| 画面 | 確認できるもの |
| --- | --- |
| 20人の声 | 同じ単語・日常文・感情表現。人物ごとに肖像と声のプロフィールを表示 |
| モデル比較 | BobとJennifer。単独語7種、複文、疑問、感情、弱形・連結、同綴異音語、同音異綴語。Kokoro、Supertonic、ブラウザ標準音声を同じ英文で比較 |
| 二人の会話 | Bob / Jennifer、Nick / Lisa、Bill / Monica の3場面。最初の場面はKokoroとSupertonic両方の収録音声あり。標準音声の再生は端末が対応する場合に利用可 |
| Pixel 9 端末内合成 | Kokoro WASM/q8・WebGPU/fp32、初回初期化、文別のWAV完成時間・RTF、常駐時再測定、JSON保存 |

評価の順序は、発音精度、自然さ・韻律、人物の識別、再現性、バッチ費用、会話時の速度。まずモデル比較の `read` 2種類を確認する。次に、全員の「日常文」と「驚き・喜び」で声を選び、会話で話者交替を確認する。迷う人物は同じ文を目を閉じて聞き、区別できるかを確かめる。

## 再現

Linux / Python 3.12 / FFmpeg（libmp3lame）/ curl。モデル取得にはインターネットが必要で、APIキー・課金登録は不要。モデルはKokoro約103 MB、Supertonic約399 MBをキャッシュする。

```sh
cd experiments/character-voice-lab
python3 -m venv /tmp/english-pwa-voice-venv
/tmp/english-pwa-voice-venv/bin/pip install -r requirements.txt
/tmp/english-pwa-voice-venv/bin/python generate.py kokoro --stage pilot
/tmp/english-pwa-voice-venv/bin/python generate.py supertonic --stage pilot
/tmp/english-pwa-voice-venv/bin/python generate.py kokoro --stage cast
/tmp/english-pwa-voice-venv/bin/python generate.py supertonic --stage cast
/tmp/english-pwa-voice-venv/bin/python build_bundle.py
/tmp/english-pwa-voice-venv/bin/python build_bundle.py /tmp/English-PWA-Voice-Lab.html
```

収録済みファイルの検証と配布版の作成に、モデルの取得は不要。同じ入力と音源ハッシュを持つファイルは再利用する。キャッシュのダウンロード先は `--cache` で変更できる。測り直す場合は `--force` を指定する。モデル・音声プリセットのリビジョン、プロファイル名、英文と成果物のSHA-256はマニフェストに残す。モデル本体・プリセット・Private教材はリポジトリへ追加していない。

## 試験範囲

公開版 v5.119、main の `9d3eb271032324b99d28c154d8822a459052acae` から分岐。人物データのGit blob `1d0c61711d763373e1f587ecde16ff9f07cb1a45` が、指定されたPrivate基準の同名ファイルと一致。20人の声の設定と新規英文だけを本ラボで定義した。公開版の入口、SW、Android、教材データには変更を加えていない。

- [調査・実測・P4/P5/P6引き継ぎ](RESEARCH.md)
- [20人の音声プロフィール](profiles.json)
- [自作評価文・発音観点](corpus.json)
