import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getGameTraceReadinessDiagnostics,
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
    recordGameTraceReadiness('native-capability-resolved', {
      available: true,
      enabled: true,
      transcript: 'private speech text',
      audio: 'private audio payload',
    });
    recordGameTraceReadiness('panel-created', { panelPresent: true, panelConnected: true });
    recordGameTraceReadiness('initialization-complete', { terminal: true });

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
      'native-capability-resolved', 'panel-created', 'initialization-complete',
    ]);
    assert.deepEqual(diagnostics.events[0], {
      sequence: 1,
      stage: 'native-capability-resolved',
      atMs: diagnostics.events[0].atMs,
      available: true,
      enabled: true,
    });
    assert.equal(diagnostics.javascriptErrors[0].errorType, 'TypeError');
    assert.equal(diagnostics.javascriptErrors[0].source, 'https://localhost/scripts/app.js');
    assert.equal(diagnostics.javascriptErrors[1].errorType, 'RangeError');
    assert.equal(dispatched.length, 3);
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
