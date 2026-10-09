package com.miyatayuuma.englishpwa;

import static org.junit.Assert.*;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import org.junit.Test;
import org.junit.FixMethodOrder;
import org.junit.runners.MethodSorters;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public class NativeShellGateTest {
    private String eval(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, result -> {
            value.set(result);
            latch.countDown();
        }));
        assertTrue("WebView evaluation timed out", latch.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    private void awaitTrue(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        long deadline = System.currentTimeMillis() + 60000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(eval(scenario, script))) return;
            Thread.sleep(100);
        }
        fail("Gate condition not reached: " + script + " diagnostics=" + eval(scenario,
            "JSON.stringify({bridge:window.__gateBridge,permission:window.__gatePermission})"));
    }

    @Test
    public void c_shellRendersDataLoadsBridgeCallsAndServiceWorkerStaysDisabled() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitTrue(scenario, "!!document.querySelector('#app') && document.readyState === 'complete'");
            assertEquals("\"android\"", eval(scenario, "Capacitor.getPlatform()"));
            awaitTrue(scenario, "!!document.querySelector('#nativeAsrTest')");
            scenario.onActivity(activity -> {
                android.view.View container=(android.view.View)activity.getBridge().getWebView().getParent();
                androidx.core.view.WindowInsetsCompat insets=androidx.core.view.ViewCompat.getRootWindowInsets(container);
                assertNotNull(insets);
                androidx.core.graphics.Insets bars=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars());
                assertTrue(container.getPaddingTop()>=bars.top);
                assertTrue(container.getPaddingBottom()>=bars.bottom);
            });
            eval(scenario, "window.__media=null; import('https://localhost/scripts/native/media.js').then(m=>m.getNativeMedia()).then(async p=>window.__media={status:await p.status(),voices:await p.voices()}); true");
            awaitTrue(scenario, "typeof window.__media?.status?.selected === 'boolean' && Array.isArray(window.__media?.voices?.voices)");

            awaitTrue(scenario, "document.querySelector('#loadingOverlay')?.classList.contains('hidden') === true");
            eval(scenario, "window.__gateData=null; fetch('/data/items.json').then(r=>r.json()).then(x=>window.__gateData=x.length); true");
            awaitTrue(scenario, "window.__gateData === 560");
            eval(scenario, "window.__gateBridge=null; import('https://localhost/scripts/native/nativeSpeech.js').then(m=>m.getNativeSpeech()).then(p=>p.isAvailable()).then(x=>window.__gateBridge=x).catch(e=>window.__gateBridge={error:e.message}); true");
            awaitTrue(scenario, "typeof window.__gateBridge?.available === 'boolean' && window.__gateBridge.apiLevel >= 24");
            eval(scenario, "window.__gateSW=null; navigator.serviceWorker.getRegistrations().then(x=>window.__gateSW=x.length); true");
            awaitTrue(scenario, "window.__gateSW === 0");
        }
    }

    @Test
    public void b_productionBackendStartsAndCancelsWithoutWebSpeech() throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        device.executeShellCommand("pm grant com.miyatayuuma.englishpwa android.permission.RECORD_AUDIO");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitTrue(scenario, "document.readyState === 'complete' && !!window.Capacitor");
            eval(scenario, "window.__productionGate={}; Promise.all([import('https://localhost/scripts/native/androidSpeechBackend.js'),import('https://localhost/scripts/speech/recognitionPolicy.js')]).then(async ([b,c])=>{ const driver=new b.AndroidSpeechRecognizerBackend(); window.__productionDriver=driver; driver.context=c.buildRecognitionContext({mode:'read',itemId:'E0102'}); driver.onstart=()=>{window.__productionGate.started=true;driver.abort();}; driver.onerror=e=>window.__productionGate.error=e; driver.onend=()=>window.__productionGate.ended=true; window.__productionGate.route=b.selectRecognitionBackend()===b.AndroidSpeechRecognizerBackend; driver.start(); }).catch(e=>window.__productionGate.error=e.message); true");
            awaitTrue(scenario, "window.__productionGate?.ended === true");
            assertEquals("true", eval(scenario, "window.__productionGate.route === true && window.__productionGate.started === true && !window.__productionGate.error"));
            assertEquals("true", eval(scenario, "window.__productionDriver.maxAlternatives === 20 && window.__productionDriver.state === 'idle'"));
        }
    }

    @Test
    public void d_debugValidationUsesActualTargetAuthority() throws Exception {
        Intent intent = new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(), MainActivity.class);
        intent.putExtra("nativeSpeechGate", true);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(intent)) {
            awaitTrue(scenario, "document.querySelector('#acceptanceCase')?.options.length === 14");
            assertEquals("true", eval(scenario, "document.querySelector('#acceptanceCase').value === 'D01'"));
            eval(scenario, "document.querySelector('#acceptanceCase').value='D02'; document.querySelector('#acceptanceCase').dispatchEvent(new Event('change')); true");
            awaitTrue(scenario, "document.querySelector('#expected')?.textContent.includes('yield to something') === true");
            assertEquals("true", eval(scenario, "document.querySelector('#expected').textContent.includes('yield to any threats')"));
            assertEquals("true", eval(scenario, "Capacitor.DEBUG === true && !document.querySelector('#condition')"));
            eval(scenario, "document.querySelector('#fixture').value='vocab:01306'; document.querySelector('#fixture').dispatchEvent(new Event('change')); true");
            assertEquals("true", eval(scenario, "document.querySelector('#expected').textContent.includes('yelled')"));
            eval(scenario, "document.querySelector('#fixture').value='word:yield'; document.querySelector('#fixture').dispatchEvent(new Event('change')); true");
            assertEquals("true", eval(scenario, "document.querySelector('#prompt').textContent === 'yield'"));
            eval(scenario, "document.querySelector('#fixture').value='word:yell'; document.querySelector('#fixture').dispatchEvent(new Event('change')); true");
            assertEquals("true", eval(scenario, "document.querySelector('#prompt').textContent === 'yell' && !!document.querySelector('#copy')"));
            eval(scenario, "document.querySelector('#control').value='content word違い'; document.querySelector('#control').dispatchEvent(new Event('change')); true");
            assertEquals("true", eval(scenario, "document.querySelector('#prompt').textContent === '発話内容を入力してください'"));
            eval(scenario, "document.querySelector('#fixture').value='E0102'; document.querySelector('#fixture').dispatchEvent(new Event('change')); true");
            assertEquals("true", eval(scenario, "document.querySelector('#expected').textContent.includes('Mom yelled in a rage.')"));
            eval(scenario, "document.querySelector('#acceptanceCase').value='D07'; document.querySelector('#acceptanceCase').dispatchEvent(new Event('change')); true");
            assertEquals("true", eval(scenario, "document.querySelector('#recognitionHarness').hidden"));
            eval(scenario, "document.querySelector('#openGameTrace').click(); true");
            awaitTrue(scenario, "!!document.querySelector('#app') && !!document.querySelector('#nativeGameTracePanel')");
            assertEquals("true", eval(scenario, "document.querySelector('#nativeGameTracePanel')?.textContent.includes('GAME TRACE') === true"));
            eval(scenario, "window.Capacitor.Plugins.NativeGameTrace.openAcceptanceCases(); true");
            awaitTrue(scenario, "document.querySelector('#acceptanceCase')?.options.length === 14");
        }
    }

    @Test
    public void a_permissionIsRequestedOnDemandAndGrantedThroughSystemDialog() throws Exception {
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        // Fresh install starts denied. Revoking after a grant kills the target
        // process, including instrumentation, so permission runs first.
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitTrue(scenario, "!!window.Capacitor?.Plugins?.NativeSpeech");
            assertEquals(PackageManager.PERMISSION_DENIED, InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO));
            eval(scenario, "window.__gatePermission=null; import('https://localhost/scripts/native/nativeSpeech.js').then(m=>m.getNativeSpeech()).then(p=>p.requestPermission()).then(x=>window.__gatePermission=x).catch(e=>window.__gatePermission={error:e.message}); true");
            UiObject2 button = device.wait(Until.findObject(By.res(Pattern.compile(".*:id/permission_allow_foreground_only_button"))), 15000);
            assertNotNull("Microphone system permission dialog missing: " + eval(scenario, "JSON.stringify(window.__gatePermission)"), button);
            button.click();
            awaitTrue(scenario, "window.__gatePermission?.granted === true");
            assertEquals(PackageManager.PERMISSION_GRANTED, InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO));
        }
    }
}
