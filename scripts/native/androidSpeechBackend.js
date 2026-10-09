import { getNativeSpeech } from './nativeSpeech.js';
import { isNativeAndroid } from './runtimePlatform.js';
import { nativeWebResultEvent } from './recognitionEvidence.js';
import { REQUESTED_MAX_ALTERNATIVES, SPEECH_DISABLED_MODES } from '../speech/recognitionPolicy.js';

let sequence = 0;
let owner = null;

export function selectRecognitionBackend(scope = globalThis, mode = null) {
  if (SPEECH_DISABLED_MODES.has(mode)) return null;
  if (isNativeAndroid(scope)) return AndroidSpeechRecognizerBackend;
  const web = scope.window ?? scope;
  return web.SpeechRecognition ?? web.webkitSpeechRecognition ?? null;
}

export function nativeSpeechDiagnostic(type, value, scope = globalThis) {
  if (isNativeAndroid(scope) && scope.Capacitor?.DEBUG === true) {
    const summary = type === 'event'
      ? {
        eventType: value?.type ?? null,
        sessionId: value?.sessionId ?? null,
        requestedMaxResults: value?.requestedMaxResults ?? null,
        providerReturnedCount: value?.providerReturnedCount ?? null,
        retainedCandidateCount: value?.retainedCandidateCount ?? value?.alternatives?.length ?? null,
        errorCode: value?.code ?? null,
      }
      : type === 'configuration'
        ? {
          backend: value?.backend ?? null,
          sessionId: value?.sessionId ?? null,
          provider: value?.provider ?? null,
          apiLevel: value?.apiLevel ?? null,
          requestedMaxResults: value?.requestedMaxResults ?? null,
        }
        : {
          mode: value?.mode ?? null,
          itemId: value?.itemId ?? null,
          entryId: value?.entryId ?? null,
          decision: value?.decision?.type ?? value?.evaluation?.pass ?? value?.success ?? null,
          asrRank: value?.decision?.asrRank ?? value?.recognitionCandidate?.asrRank ?? null,
          recognitionAuthority: value?.decision?.recognitionAuthority ?? value?.recognitionCandidate?.source ?? null,
        };
    scope.console?.debug?.('NativeSpeech', type, summary);
  }
}

// Web-Speech-shaped events adapt native candidates to existing JS grading.
// This backend never rewrites transcripts or decides correctness.
export class AndroidSpeechRecognizerBackend {
  constructor({ pluginProvider = getNativeSpeech } = {}) {
    this.pluginProvider = pluginProvider;
    this.waitsForFinalResult = true;
    this.state = 'idle';
    this.maxAlternatives = REQUESTED_MAX_ALTERNATIVES;
    this.sessionId = `native-${Date.now()}-${++sequence}`;
  }

  start() {
    if (this.state !== 'idle' || owner) throw new Error('Native recognition is busy');
    owner = this;
    this.state = 'opening';
    this.cancelRequested = false;
    this.stopRequested = false;
    this.sentStop = false;
    this.sentCancel = false;
    this.nativeStarted = false;
    this.started = false;
    this.startup = this.open().catch(error => this.fail(error.code ?? 'START_FAILED', error.message));
  }

  async open() {
    this.plugin = await this.pluginProvider();
    if (this.cancelRequested) { this.finish(); return; }
    const capabilities = await this.plugin.isAvailable();
    this.capabilities = capabilities;
    this.onconfiguration?.({
      backendType: 'android-native',
      nativeSessionId: this.sessionId,
      providerInfo: {
        provider: capabilities.provider ?? null,
        apiLevel: capabilities.apiLevel ?? null,
        available: capabilities.available === true,
        microphone: capabilities.microphone ?? null,
      },
      requestedMaxAlternatives: REQUESTED_MAX_ALTERNATIVES,
    });
    if (this.cancelRequested) { this.finish(); return; }
    if (!capabilities.available) throw Object.assign(new Error('No system speech recognizer is available'), { code: 'UNAVAILABLE' });
    const permission = await this.plugin.requestPermission();
    if (this.cancelRequested) { this.finish(); return; }
    if (!permission.granted) throw Object.assign(new Error('Microphone permission was denied'), { code: 'PERMISSION_DENIED' });
    this.listener = await this.plugin.addListener('recognition', event => this.receive(event));
    if (this.cancelRequested) { this.finish(); return; }
    this.nativeStarted = true;
    nativeSpeechDiagnostic('configuration', { backend: 'Android SpeechRecognizer', sessionId: this.sessionId, ...capabilities, requestedMaxResults: REQUESTED_MAX_ALTERNATIVES });
    await this.plugin.start({ sessionId: this.sessionId });
    if (this.state === 'idle') return;
    this.state = this.stopRequested ? 'stopping' : 'listening';
    if (this.cancelRequested) await this.cancelNative();
    else if (this.stopRequested) await this.stopNative();
  }

  receive(event) {
    if (this.state === 'idle' || event.sessionId !== this.sessionId) return;
    nativeSpeechDiagnostic('event', event);
    if (this.cancelRequested) {
      if (event.type === 'end' || event.type === 'error') this.finish();
      return;
    }
    if (event.type === 'started' || event.type === 'ready') {
      if (!this.started) { this.started = true; this.onstart?.(); }
    } else if (event.type === 'partial' || event.type === 'final') {
      this.onresult?.(nativeWebResultEvent(event));
    } else if (event.type === 'error') {
      this.fail(event.code, event.message);
    } else if (event.type === 'end') {
      this.finish();
    }
  }

  stop() {
    if (this.state === 'idle' || this.stopRequested) return;
    this.stopRequested = true;
    this.state = 'stopping';
    if (this.nativeStarted) this.startup.then(() => this.stopNative()).catch(error => this.fail(error.code, error.message));
  }

  async stopNative() {
    if (this.state === 'idle' || this.sentStop || this.cancelRequested) return;
    this.sentStop = true;
    await this.plugin.stop({ sessionId: this.sessionId });
    // Do not finalize here. Native final/error must complete the session.
  }

  abort() {
    if (this.state === 'idle' || this.cancelRequested) return;
    this.cancelRequested = true;
    this.state = 'cancelling';
    if (this.nativeStarted) this.startup.then(() => this.cancelNative()).catch(() => this.finish());
    // Pending permission work checks cancellation before native start.
  }

  async cancelNative() {
    if (this.state === 'idle' || this.sentCancel) return;
    this.sentCancel = true;
    try { await this.plugin.cancel({ sessionId: this.sessionId }); }
    finally { this.finish(); }
  }

  fail(code = 'NATIVE_ERROR', message = code) {
    if (this.state === 'idle') return;
    try {
      if (!this.cancelRequested) this.onerror?.({ error: code, message, sessionId: this.sessionId });
    } finally { this.finish(); }
  }

  finish() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    if (owner === this) owner = null;
    const listener = this.listener;
    this.listener = null;
    Promise.resolve(listener?.remove?.()).catch(() => {});
    this.onend?.();
  }
}
