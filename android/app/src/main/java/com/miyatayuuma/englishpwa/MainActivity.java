package com.miyatayuuma.englishpwa;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeSpeechPlugin.class);
        super.onCreate(savedInstanceState);
        // Explicit developer entry, absent from release assets and normal UI.
        if (BuildConfig.DEBUG && getIntent().getBooleanExtra("nativeSpeechGate", false)) {
            getBridge().getWebView().loadUrl("https://localhost/native-gate.html");
        }
    }
}
