# P6用 Android Kokoro Capacitor接続仕様

Android側の単一エンジンが推論と音声出力を管理する。JavaScriptは発話計画と画面表示を担当する。P3.7のPCM・モデルハッシュ・キャラクタープロファイルを引き継ぐ。

| API | 要求 | 成功時 |
|---|---|---|
| `initialize` | `{ revision, precision, threads, provider, profileVersion }` | `{ sessionId, loaded, providerRequested, modelLoadMs }`。同一設定で常駐を再利用。変更時は進行中のキューを先に停止 |
| `synthesize` | `{ sessionId, requestId, characterId, text, phonemes? }` | `{ audioId, sampleRate, frameCount, durationMs, phonemeMs, inferenceMs, pcmMs }`。PCMはネイティブが保持し、識別子だけを返す |
| `enqueue` | `{ sessionId, turnId, requestId, audioId }` | `{ accepted, queueDepth }`。同一requestIdは再登録しない。次の1発話を先行生成 |
| `cancel` | `{ sessionId, turnId?, reason }` | `{ audioStopped, cancelledRequestIds }`。再生を即座に停止し、実行中のORTが返した旧PCMは破棄 |
| `release` | `{ sessionId }` | `{ released }`。停止後にORTセッション、PCM、音声フォーカスを解放。再呼び出し可能 |
| `getCharacterProfile` | `{ profileVersion, characterId }` | `{ voiceId, accent, speed, revision, profileVersion }` |

`playbackStatus` イベントには `sessionId, turnId, requestId, state, monotonicMs` を含める。状態は `queued`、`playing`、`ended`、`cancelled`、`error`。失敗は `code, recoverable, requestId` で識別する。候補コードは `MODEL_MISSING`、`MODEL_CHECKSUM`、`PROVIDER_UNAVAILABLE`、`PROFILE_MISMATCH`、`INVALID_PHONEMES`、`INFERENCE_FAILED`、`AUDIO_FOCUS_DENIED`、`MIC_ACTIVE`、`CANCELLED`。文字列メッセージの照合に依存しない。

音声出力と録音は同じネイティブ制御で排他にする。マイク要求で再生を停止・フラッシュし、音声フォーカスの解放後に既存SpeechRecognizerを起動する。最終認識でのみ応答再生の抑止を解除する。暫定結果、エラー、古い要求のコールバックから再生を再開しない。バックグラウンド移行とオーディオフォーカス喪失で停止し、画面へ復帰しても再キューはユーザー操作に従う。

500 ms・RTF・熱の実機データが不足する間は方式の選定を保留する。未達だった場合は、同一リビジョン・声・話速の事前生成済み短文で最初の応答を始め、その再生中に次の意味のある文を先行生成する。キャッシュ識別にはモデルリビジョン、精度、プロフィール版、声、アクセント、話速、テキストと明示音素のハッシュを含める。先行音声が間に合わなければ再生まで待ち時間を表示し、割り込みで先行結果も破棄する。P6で採る前に、音色差と無音時間を同じ受入手順で比較する。
