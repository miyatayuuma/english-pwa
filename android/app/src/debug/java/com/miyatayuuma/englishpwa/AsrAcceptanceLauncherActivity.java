package com.miyatayuuma.englishpwa;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

// Debug APK only: open the validation case selector with no PC/ADB.
public class AsrAcceptanceLauncherActivity extends Activity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("nativeSpeechGate", true);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }
}
