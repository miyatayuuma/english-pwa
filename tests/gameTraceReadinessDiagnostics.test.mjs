import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGameTraceCapabilityRequest,
  getGameTraceReadinessDiagnostics,
  installGameTraceCapabilityBridgeDiagnostics,
  installGameTraceReadinessErrorCapture,
  recordGameTraceReadiness,
} from '../scripts/native/gameTraceReadinessDiagnostics.js';

test('Game Trace readiness metadata is debug-only, ordered, and excludes payload text', () => {
  const previous = new Map(['Capacitor', 'window', 'CustomEvent'].map(key => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  const key = '__nativeGameTraceReadiness';
  const previousDiagnostics = globalThis[key];
  const listeners = new Map();
  const dispatched = [];

  try {
    delete globalThis[key];
    globalThis.Capacitor = { DEBUG: false };
    globalThis.window = {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      dispatchEvent(event) {
        dispatched.push(event);
      },
    };
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    };

    installGameTraceReadinessErrorCapture();
    assert.equal(recordGameTraceReadiness('initialization-started'), null);
    assert.equal(globalThis[key], undefined);
    assert.equal(listeners.size, 0);

    globalThis.Capacitor.DEBUG = true;
    installGameTraceReadinessErrorCapture();
    recordGameTraceReadiness('app-bootstrap-started');
    recordGameTraceReadiness('app-initialization-started');
    recordGameTraceReadiness('native-capability-requested');
    recordGameTraceReadiness('native-capability-resolved', {
      available: true,
      enabled: true,
      transcript: 'private speech text',
      audio: 'private audio payload',
    });
    recordGameTraceReadiness('panel-created', { panelPresent: true, panelConnected: true });
    recordGameTraceReadiness('initialization-complete', {
      capabilityEnabled: true,
      panelPresent: true,
      panelConnected: true,
      terminal: true,
    });
    recordGameTraceReadiness('app-initialization-complete');

    listeners.get('error')({
      error: { name: 'TypeError', message: 'private speech text' },
      filename: 'https://localhost/scripts/app.js?prompt=private',
      lineno: 9,
      colno: 4,
    });
    listeners.get('unhandledrejection')({
      reason: { name: 'RangeError', message: 'private audio payload' },
    });

    const diagnostics = getGameTraceReadinessDiagnostics();
    assert.equal(diagnostics.debugOnly, true);
    assert.equal(diagnostics.terminal, true);
    assert.deepEqual(diagnostics.events.map(event => event.stage), [
      'app-bootstrap-started', 'app-initialization-started', 'native-capability-requested',
      'native-capability-resolved', 'panel-created', 'initialization-complete',
      'app-initialization-complete',
    ]);
    assert.equal(diagnostics.phase, 'app-initialization-complete');
    assert.equal(diagnostics.events.find(event => event.stage === 'initialization-complete')?.panelConnected, true);
    assert.deepEqual(diagnostics.events[3], {
      sequence: 4,
      stage: 'native-capability-resolved',
      atMs: diagnostics.events[3].atMs,
      available: true,
      enabled: true,
    });
    assert.equal(diagnostics.javascriptErrors[0].errorType, 'TypeError');
    assert.equal(diagnostics.javascriptErrors[0].source, 'https://localhost/scripts/app.js');
    assert.equal(diagnostics.javascriptErrors[1].errorType, 'RangeError');
    assert.equal(dispatched.length, 7);
    const serialized = JSON.stringify(diagnostics);
    assert.doesNotMatch(serialized, /private speech text|private audio payload|prompt=private/);
    assert.doesNotMatch(serialized, /"transcript"|"audio"|"message"/);
  } finally {
    if (previousDiagnostics === undefined) delete globalThis[key];
    else globalThis[key] = previousDiagnostics;
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('Native capability callback diagnostics correlate delayed, concurrent, rejected, duplicate, and unknown replies by request and callback id', async () => {
  const names = ['Capacitor', 'androidBridge', 'window', 'CustomEvent'];
  const previous = new Map(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const diagnosticsKey = '__nativeGameTraceReadiness';
  const previousDiagnostics = globalThis[diagnosticsKey];
  const listeners = new Map();
  const received = [];
  let nextCallbackId = 100;

  try {
    delete globalThis[diagnosticsKey];
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options.detail; }
    };
    globalThis.window = {
      addEventListener(type, listener) { listeners.set(type, listener); },
      dispatchEvent() {},
    };
    globalThis.androidBridge = {
      onmessage(event) { received.push(JSON.parse(event.data).callbackId); },
    };
    globalThis.Capacitor = {
      DEBUG: true,
      toNative(pluginName, methodName, options, callback) {
        return String(++nextCallbackId);
      },
      fromNative() {},
    };

    installGameTraceReadinessErrorCapture();
    assert.equal(installGameTraceCapabilityBridgeDiagnostics(), true);
    const first = createGameTraceCapabilityRequest('initializer');
    const second = createGameTraceCapabilityRequest('launch-update');
    const third = createGameTraceCapabilityRequest('gate-snapshot');
    const firstCallbackId = Capacitor.toNative('NativeGameTrace', 'getCapability', first, {});
    const secondCallbackId = Capacitor.toNative('NativeGameTrace', 'getCapability', second, {});
    const thirdCallbackId = Capacitor.toNative('NativeGameTrace', 'getCapability', third, {});

    const delayedResponse = new Promise(resolve => setTimeout(() => {
      androidBridge.onmessage({ data: JSON.stringify({
        pluginId: 'NativeGameTrace', methodName: 'getCapability', callbackId: secondCallbackId, success: true,
        data: { transcript: 'private transcript payload' },
      }) });
      resolve();
    }, 10));
    assert.equal(getGameTraceReadinessDiagnostics().events.some(
      event => event.stage === 'native-capability-bridge-response-received'), false);
    await delayedResponse;
    Capacitor.fromNative({
      pluginId: 'NativeGameTrace', methodName: 'getCapability', callbackId: thirdCallbackId, success: true,
    });
    androidBridge.onmessage({ data: JSON.stringify({
      pluginId: 'NativeGameTrace', methodName: 'getCapability', callbackId: firstCallbackId, success: false,
      error: { message: 'private rejection detail' },
    }) });
    androidBridge.onmessage({ data: JSON.stringify({
      pluginId: 'NativeGameTrace', methodName: 'getCapability', callbackId: firstCallbackId, success: false,
    }) });
    // A callback id from a replaced document has no registration in this document.
    androidBridge.onmessage({ data: JSON.stringify({
      pluginId: 'NativeGameTrace', methodName: 'getCapability', callbackId: '999', success: true,
    }) });

    const events = getGameTraceReadinessDiagnostics().events;
    const requests = events.filter(event => event.stage === 'native-capability-bridge-request-created');
    const responses = events.filter(event => event.stage === 'native-capability-bridge-response-received');
    const unmatched = events.filter(event => event.stage === 'native-capability-bridge-response-unmatched');
    assert.equal(requests.length, 3);
    assert.equal(requests[0].requestId, first.diagnosticRequestId);
    assert.equal(requests[0].requestType, 'initializer');
    assert.equal(requests[0].documentGenerationId, getGameTraceReadinessDiagnostics().documentGenerationId);
    assert.equal(requests[0].callbackId, firstCallbackId);
    assert.equal(requests[1].requestId, second.diagnosticRequestId);
    assert.equal(requests[1].requestType, 'launch-update');
    assert.equal(requests[1].callbackId, secondCallbackId);
    assert.equal(requests[2].requestId, third.diagnosticRequestId);
    assert.equal(requests[2].requestType, 'gate-snapshot');
    assert.equal(requests[2].callbackId, thirdCallbackId);
    assert.deepEqual(responses.map(event => [event.requestId, event.callbackId, event.resolutionStatus, event.transport]), [
      [second.diagnosticRequestId, secondCallbackId, 'resolved', 'android-bridge-onmessage'],
      [third.diagnosticRequestId, thirdCallbackId, 'resolved', 'capacitor-from-native'],
      [first.diagnosticRequestId, firstCallbackId, 'rejected', 'android-bridge-onmessage'],
    ]);
    assert.equal(unmatched.length, 1);
    assert.equal(unmatched[0].callbackId, '999');
    assert.equal(unmatched[0].documentGenerationId, getGameTraceReadinessDiagnostics().documentGenerationId);
    assert.equal(Object.hasOwn(unmatched[0], 'requestId'), false);
    assert.deepEqual(received, [secondCallbackId, firstCallbackId, firstCallbackId, '999']);
    assert.doesNotMatch(JSON.stringify(getGameTraceReadinessDiagnostics()), /private transcript payload|private rejection detail/);

    const uninstrumented = {
      DEBUG: false,
      toNative() { return '101'; },
    };
    globalThis.Capacitor = uninstrumented;
    assert.equal(installGameTraceCapabilityBridgeDiagnostics(), false);
    assert.deepEqual(createGameTraceCapabilityRequest('initializer'), {});
    assert.equal(Object.hasOwn(uninstrumented, '__nativeGameTraceCapabilityBridgeDiagnosticsInstalled'), false);
  } finally {
    if (previousDiagnostics === undefined) delete globalThis[diagnosticsKey];
    else globalThis[diagnosticsKey] = previousDiagnostics;
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
