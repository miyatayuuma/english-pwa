package com.miyatayuuma.englishpwa;

import static org.junit.Assert.*;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.util.Log;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.json.JSONObject;
import org.json.JSONTokener;
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
    private int successfulReadinessStageSequence;

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

    private String diagnosticSnapshot(ActivityScenario<MainActivity> scenario) throws Exception {
        AtomicReference<String> nativeJson = new AtomicReference<>("{}");
        scenario.onActivity(activity -> nativeJson.set(
            activity.getNativeGameTraceReadinessDiagnostics().toString()));
        String begin = "window.__gateDiagnosticSnapshot={page:{href:location.href,readyState:document.readyState,appPresent:!!document.querySelector('#app'),panelPresent:!!document.querySelector('#nativeGameTracePanel'),panelConnected:!!document.querySelector('#nativeGameTracePanel')?.isConnected,validationCaseCount:document.querySelector('#acceptanceCase')?.options.length??null,validationButtonPresent:!!document.querySelector('#openGameTrace')},bridge:{capacitorAvailable:!!window.Capacitor,debug:window.Capacitor?.DEBUG===true,nativeGameTracePluginAvailable:!!window.Capacitor?.Plugins?.NativeGameTrace},navigation:window.__nativeGameTraceNavigation??null,initialization:window.__nativeGameTraceReadiness??null,capability:{status:'pending',value:null,errorType:null,requestId:null},native:{status:'pending',value:null,errorType:null}};const p=window.Capacitor?.Plugins?.NativeGameTrace;const capabilityRequestId=(window.__nativeGameTraceReadiness?.documentGenerationId||'gate')+'-gate-snapshot';window.__gateDiagnosticSnapshot.capability.requestId=capabilityRequestId;if(!p){window.__gateDiagnosticSnapshot.capability.status='unavailable';window.__gateDiagnosticSnapshot.native.status='unavailable';}else{if(typeof p.getCapability==='function')p.getCapability({diagnosticRequestId:capabilityRequestId,diagnosticRequestType:'gate-snapshot'}).then(value=>{window.__gateDiagnosticSnapshot.capability={status:'resolved',value,errorType:null,requestId:capabilityRequestId};}).catch(error=>{window.__gateDiagnosticSnapshot.capability={status:'rejected',value:null,errorType:typeof error?.name==='string'?error.name:'UnknownError',requestId:capabilityRequestId};});else window.__gateDiagnosticSnapshot.capability.status='method-unavailable';if(typeof p.getReadinessDiagnostics==='function')p.getReadinessDiagnostics().then(value=>{window.__gateDiagnosticSnapshot.native={status:'resolved',value,errorType:null};}).catch(error=>{window.__gateDiagnosticSnapshot.native={status:'rejected',value:null,errorType:typeof error?.name==='string'?error.name:'UnknownError'};});else window.__gateDiagnosticSnapshot.native.status='method-unavailable';}true";
        try {
            eval(scenario, begin);
            long deadline = System.currentTimeMillis() + 5000;
            while (System.currentTimeMillis() < deadline) {
                if ("true".equals(eval(scenario,
                        "!!window.__gateDiagnosticSnapshot && window.__gateDiagnosticSnapshot.capability.status !== 'pending' && window.__gateDiagnosticSnapshot.native.status !== 'pending'"))) break;
                Thread.sleep(100);
            }
            JSONObject result = new JSONObject();
            String javascriptSnapshot = eval(scenario,
                "JSON.stringify(window.__gateDiagnosticSnapshot || {capture:'unavailable'})");
            Object decodedSnapshot = new JSONTokener(javascriptSnapshot).nextValue();
            String javascriptJson = decodedSnapshot instanceof String
                ? (String) decodedSnapshot : javascriptSnapshot;
            result.put("javascript", new JSONObject(javascriptJson));
            result.put("native", new JSONObject(nativeJson.get()));
            return result.toString();
        } catch (Exception captureFailure) {
            JSONObject result = new JSONObject();
            result.put("javascriptCaptureError", captureFailure.getClass().getSimpleName());
            result.put("native", new JSONObject(nativeJson.get()));
            return result.toString();
        }
    }

    private void awaitCondition(ActivityScenario<MainActivity> scenario, String stage, String script) throws Exception {
        long deadline = System.currentTimeMillis() + 60000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(eval(scenario, script))) {
                Log.i("NativeGameTraceGate", "instrumentation-stage-pass sequence="
                    + (++successfulReadinessStageSequence) + " stage=" + stage);
                return;
            }
            Thread.sleep(100);
        }
        String diagnostics = diagnosticSnapshot(scenario);
        Log.e("NativeGameTraceGate", "instrumentation-stage-failed lastPassSequence="
            + successfulReadinessStageSequence + " stage=" + stage + " diagnostics=" + diagnostics);
        fail("Game Trace readiness stage failed [" + stage + "]: " + script
            + " lastPassSequence=" + successfulReadinessStageSequence + " diagnostics=" + diagnostics);
    }

    private void awaitTrue(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        awaitCondition(scenario, "general WebView readiness", script);
    }

    private void assertStageTrue(ActivityScenario<MainActivity> scenario, String stage, String script) throws Exception {
        if (!"true".equals(eval(scenario, script))) {
            fail("Game Trace readiness stage failed [" + stage + "]: " + script
                + " diagnostics=" + diagnosticSnapshot(scenario));
        }
    }

    private Intent debugValidationIntent() {
        Intent intent = new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(), MainActivity.class);
        intent.putExtra("nativeSpeechGate", true);
        return intent;
    }

    private void runGameTraceNavigationCycle(ActivityScenario<MainActivity> scenario, int cycle) throws Exception {
        awaitCondition(scenario, "Stage 1 — Validation Page Ready",
            "location.pathname === '/native-gate.html' && document.readyState === 'complete' && document.querySelector('#acceptanceCase')?.options.length === 14 && !!document.querySelector('#openGameTrace') && !!window.Capacitor && window.__nativeGameTraceNavigation?.phase === 'validation-page-ready' && window.__nativeGameTraceNavigation?.events?.at(-1)?.buttonHandlerAvailable === true && window.__nativeGameTraceNavigation?.events?.at(-1)?.pluginAvailable === true");
        eval(scenario, "document.querySelector('#openGameTrace').click(); true");
        awaitCondition(scenario, "Stage 2 — Navigation Request",
            "location.pathname === '/index.html' || ['native-request-resolved','native-request-rejected'].includes(window.__nativeGameTraceNavigation?.phase)");
        assertStageTrue(scenario, "Stage 2 — Navigation Request",
            "location.pathname === '/index.html' || window.__nativeGameTraceNavigation?.phase !== 'native-request-rejected'");
        awaitCondition(scenario, "Stage 3 — WebView Navigation",
            "location.pathname === '/index.html' && document.readyState === 'complete'");
        eval(scenario, "window.__nativeGateSnapshot={status:'pending'}; Capacitor?.Plugins?.NativeGameTrace?.getReadinessDiagnostics().then(value=>window.__nativeGateSnapshot={status:'resolved',value}).catch(error=>window.__nativeGateSnapshot={status:'rejected',errorType:typeof error?.name==='string'?error.name:'UnknownError'}); true");
        awaitCondition(scenario, "Stage 3 — Native navigation authorization",
            "window.__nativeGateSnapshot?.status === 'resolved' && window.__nativeGateSnapshot?.value?.currentPage === 'app' && window.__nativeGateSnapshot?.value?.launchEnabled === true && window.__nativeGateSnapshot?.value?.events?.some(event => event.stage === 'plugin-open-resolved') && window.__nativeGateSnapshot?.value?.events?.some(event => event.stage === 'navigation-authorized') && window.__nativeGateSnapshot?.value?.events?.some(event => event.stage === 'webview-load-requested')");
        awaitCondition(scenario, "Stage 4 — Game Initialization",
            "window.__nativeGameTraceReadiness?.terminal === true");
        eval(scenario, "window.__gateCapabilityNativeSnapshot={status:'pending'}; Capacitor?.Plugins?.NativeGameTrace?.getReadinessDiagnostics().then(value=>window.__gateCapabilityNativeSnapshot={status:'resolved',value}).catch(error=>window.__gateCapabilityNativeSnapshot={status:'rejected',errorType:typeof error?.name==='string'?error.name:'UnknownError'}); true");
        awaitCondition(scenario, "Stage 4 — Native capability lifecycle snapshot",
            "window.__gateCapabilityNativeSnapshot?.status === 'resolved' && window.__gateCapabilityNativeSnapshot?.value?.currentPage === 'app'");
        assertStageTrue(scenario, "Stage 4 — Game Initialization",
            "(()=>{const events=window.__nativeGameTraceReadiness?.events||[];const request=events.find(event=>event.stage==='native-capability-facade-invoked'&&event.requestType==='initializer');const bridge=events.find(event=>event.stage==='native-capability-bridge-request-created'&&event.requestId===request?.requestId);const response=events.find(event=>event.stage==='native-capability-bridge-response-received'&&event.requestId===request?.requestId&&event.callbackId===bridge?.callbackId&&event.resolutionStatus==='resolved');const settled=events.find(event=>event.stage==='native-capability-promise-settled'&&event.requestId===request?.requestId&&event.resolutionStatus==='resolved');const native=window.__gateCapabilityNativeSnapshot?.value?.events||[];const nativePhase=phase=>native.some(event=>event.requestId===request?.requestId&&event.callbackId===bridge?.callbackId&&event.requestType==='initializer'&&event.stage===phase);return !!request?.documentGenerationId&&!!bridge?.callbackId&&!!response&&!!settled&&nativePhase('plugin-capability-requested')&&nativePhase('plugin-capability-result-constructed')&&nativePhase('plugin-call-resolve-invoked')&&nativePhase('plugin-call-resolve-returned')&&native.find(event=>event.requestId===request?.requestId&&event.callbackId===bridge?.callbackId&&event.stage==='plugin-call-resolve-invoked')?.threadName==='main'&&events.some(event=>event.stage==='initialization-complete'&&event.terminal===true&&event.capabilityEnabled===true&&event.panelPresent===true&&event.panelConnected===true)})();");
        awaitCondition(scenario, "Stage 5 — Panel Acceptance",
            "!!document.querySelector('#nativeGameTracePanel')?.isConnected && document.querySelector('#nativeGameTracePanel')?.textContent.includes('GAME TRACE') === true");
        eval(scenario, "window.__gateReturnResult='pending'; window.Capacitor?.Plugins?.NativeGameTrace?.openAcceptanceCases().then(()=>window.__gateReturnResult='resolved').catch(error=>window.__gateReturnResult=typeof error?.name==='string'?error.name:'UnknownError'); true");
        awaitCondition(scenario, "Stage 5 — Return to Validation Page",
            "location.pathname === '/native-gate.html' && document.readyState === 'complete' && document.querySelector('#acceptanceCase')?.options.length === 14");
        eval(scenario, "window.__gateReturnCapability=null; const requestId=(window.__nativeGameTraceReadiness?.documentGenerationId||'gate')+'-gate-return'; window.Capacitor?.Plugins?.NativeGameTrace?.getCapability({diagnosticRequestId:requestId,diagnosticRequestType:'gate-return'}).then(value=>window.__gateReturnCapability=value).catch(error=>window.__gateReturnCapability={errorType:typeof error?.name==='string'?error.name:'UnknownError'}); true");
        awaitCondition(scenario, "Stage 5 — Native Capability Reset",
            "window.__gateReturnCapability?.available === true");
        assertStageTrue(scenario, "Stage 5 — Capability Reset",
            "window.__gateReturnCapability?.enabled === false && !document.querySelector('#nativeGameTracePanel')");
        eval(scenario, "window.__nativeGateReturnSnapshot={status:'pending'}; Capacitor?.Plugins?.NativeGameTrace?.getReadinessDiagnostics().then(value=>window.__nativeGateReturnSnapshot={status:'resolved',value}).catch(error=>window.__nativeGateReturnSnapshot={status:'rejected',errorType:typeof error?.name==='string'?error.name:'UnknownError'}); true");
        awaitCondition(scenario, "Stage 5 — Native return authorization",
            "window.__nativeGateReturnSnapshot?.status === 'resolved' && window.__nativeGateReturnSnapshot?.value?.currentPage === 'native-gate' && window.__nativeGateReturnSnapshot?.value?.launchEnabled === false && window.__nativeGateReturnSnapshot?.value?.events?.some(event => event.stage === 'plugin-return-resolved') && window.__nativeGateReturnSnapshot?.value?.events?.some(event => event.stage === 'return-navigation-authorized')");
        Log.i("NativeGameTraceGate", "ACCEPTANCE_CYCLE_PASS round=" + cycle);
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
            eval(scenario, "window.__asr09d=null; Promise.all([import('https://localhost/scripts/speech/speechAlignment.js'),import('https://localhost/scripts/speech/vocabularySpeechEvidence.js')]).then(([a,v])=>{const match=a.findSpeechSurfaceMatch('They had written it.','They’d written it.',{context:{mode:'vocabulary'},attemptId:'android-asr09d',asrRank:1});const answer=v.classifyVocabularySpeechAnswer({entry:{id:'android-asr09d',canonical:'They had written it.'},transcript:'unrelated',recognitionComplete:true,completionState:'finalized',attemptId:'android-asr09d',recognitionSegments:[{segmentIndex:2,primaryTranscript:'unrelated',isFinal:true,alternatives:[{transcript:'unrelated',asrRank:0},{transcript:'They’d written it.',asrRank:1}]}]});window.__asr09d={match:match?.decisionId,auxiliary:match?.selectedAuxiliary,answer:answer.type,rank:answer.asrRank,raw:answer.rawTranscript,attempt:answer.speechMatch?.attemptId};}).catch(e=>window.__asr09d={error:e.message}); true");
            awaitTrue(scenario, "window.__asr09d?.answer === 'target'");
            assertEquals("true", eval(scenario, "window.__asr09d.match==='ambiguous-d' && window.__asr09d.auxiliary==='had' && window.__asr09d.rank===1 && window.__asr09d.raw==='They’d written it.' && window.__asr09d.attempt==='android-asr09d'"));
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
        ActivityScenario<MainActivity> scenario = ActivityScenario.launch(debugValidationIntent());
        try {
            awaitCondition(scenario, "Stage 1 — Validation Page Ready",
                "location.pathname === '/native-gate.html' && document.readyState === 'complete' && document.querySelector('#acceptanceCase')?.options.length === 14");
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
            for (int cycle = 1; cycle <= 10; cycle++) {
                runGameTraceNavigationCycle(scenario, cycle);
                if (cycle == 3 || cycle == 6) {
                    scenario.close();
                    scenario = ActivityScenario.launch(debugValidationIntent());
                    awaitCondition(scenario, "Fresh Activity launch after cycle " + cycle,
                        "location.pathname === '/native-gate.html' && document.readyState === 'complete' && document.querySelector('#acceptanceCase')?.options.length === 14");
                    assertStageTrue(scenario, "Fresh Activity launch readiness",
                        "document.querySelector('#acceptanceCase').value === 'D01' && !document.querySelector('#nativeGameTracePanel')");
                }
            }
            Log.i("NativeGameTraceGate", "ACCEPTANCE_CYCLES_PASS total=10 freshActivityRelaunches=2");
        } finally {
            scenario.close();
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
            // On a cold API 35 emulator the system PermissionController took
            // 15.2 seconds to surface this dialog; keep waiting for the real
            // system button instead of treating that launch delay as absence.
            UiObject2 button = device.wait(Until.findObject(By.res(Pattern.compile(".*:id/permission_allow_foreground_only_button"))), 30000);
            assertNotNull("Microphone system permission dialog missing: " + eval(scenario, "JSON.stringify(window.__gatePermission)"), button);
            button.click();
            awaitTrue(scenario, "window.__gatePermission?.granted === true");
            assertEquals(PackageManager.PERMISSION_GRANTED, InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.RECORD_AUDIO));
        }
    }
}
