# Android の音声と検証

Android 版は Capacitor の `NativeSpeech` で端末の音声認識を起動し、ブラウザ版は Web Speech を使用します。採点は共通の JavaScript で行います。認識中の暫定候補はプレビューに使い、採点・SRS の更新は確定結果が対象です。録音ファイルは保存しません。

`NativeMedia` はシステムの TTS、Storage Access Framework の音源フォルダ権限と、学習バックアップの保存を扱います。JSON 復元のファイル選択は WebView のファイル入力を使います。外部音源の権限は端末に残ります。

## Debug APK と動作確認

```sh
npm ci
npm run native:sync
./android/gradlew -p android assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity
```

音声ブリッジの検証画面は Debug APK に含まれます。

```sh
adb shell am force-stop com.miyatayuuma.englishpwa
adb shell am start -n com.miyatayuuma.englishpwa/.MainActivity --ez nativeSpeechGate true
adb logcat -s NativeSpeech
```

GitHub Actions の API 35 エミュレーターテストは、通常起動・教材・音声ブリッジ・マイク権限を検証します。端末のプロバイダーによる音声認識精度とファイル選択・保存は実機で確認します。Pixel で使える APK と検証手順の整備には [Pixel 受入キット](../tools/pixel-acceptance/README.md) を参照してください。
