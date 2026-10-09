/**
 * Install a controllable Web Speech API mock in a Playwright page.
 *
 * Result delivery and terminal delivery are deliberately separate operations:
 * inject()/emitFinal()/emitInterim() never dispatch `end`. Tests choose whether
 * an attempt ends naturally, is stopped, is delayed, or remains pending.
 */
export function installMockSpeechRecognition({ stateKey = '__mockSpeech', stopBehavior = 'normal', enabled = true } = {}) {
  let nextAttemptId = 1;
  const state = () => {
    const current = window[stateKey] || (window[stateKey] = {});
    if (!Array.isArray(current.events)) current.events = [];
    if (!Array.isArray(current.attempts)) current.attempts = [];
    return current;
  };

  class MockRecognition {
    constructor() {
      this.attemptId = nextAttemptId++;
      this.lifecycleState = 'created';
      this.results = [];
      this.phrases = [];
      this.stopCalls = 0;
      this.abortCalls = 0;
      this.stopPlan = null;
      state().attempts.push(this.attemptId);
      state().latest = this;
    }

    record(type, detail = {}) {
      state().events.push({
        type,
        attemptId: this.attemptId,
        state: this.lifecycleState,
        at: Math.round(performance.now()),
        ...detail,
      });
    }

    start() {
      this.lifecycleState = 'active';
      state().startCount = (state().startCount || 0) + 1;
      state().starts = (state().starts || 0) + 1;
      this.phrasesAtStart = this.phrases.map((phrase) => ({ text: phrase.phrase, boost: phrase.boost }));
      this.record('start');
      this.onstart?.();
    }

    stop() {
      if (this.lifecycleState !== 'active' && this.lifecycleState !== 'stopping') return;
      this.stopCalls += 1;
      this.lifecycleState = 'stopping';
      this.record('stop-request');

      const plan = this.stopPlan;
      this.stopPlan = null;
      if (plan?.final !== undefined) {
        setTimeout(() => {
          this.emitFinal(plan.final);
          if (!plan.holdTerminal) {
            setTimeout(() => this.emitEnd(), Math.max(0, Number(plan.terminalDelayMs) || 0));
          }
        }, Math.max(0, Number(plan.finalDelayMs) || 0));
        return;
      }
      if (plan?.holdTerminal || stopBehavior === 'hold') return;
      const delay = plan && Number.isFinite(plan.terminalDelayMs)
        ? Math.max(0, plan.terminalDelayMs)
        : stopBehavior === 'delayed' ? 40 : 0;
      setTimeout(() => this.emitEnd(), delay);
    }

    abort() {
      this.abortCalls += 1;
      this.lifecycleState = 'aborted';
      this.record('abort');
      this.emitError('aborted');
      this.emitEnd();
    }

    makeResult(text, isFinal) {
      const candidates = (Array.isArray(text) ? text : [text]).map((transcript) => ({
        transcript: String(transcript),
        confidence: 0,
      }));
      return Object.assign(candidates, { isFinal });
    }

    emitResult(text, isFinal) {
      const last = this.results.length - 1;
      const index = last >= 0 && !this.results[last].isFinal ? last : this.results.length;
      this.results[index] = this.makeResult(text, isFinal);
      const transcripts = (Array.isArray(text) ? text : [text]).map(candidate => String(candidate?.transcript ?? candidate ?? ''));
      this.record('result', { resultIndex: index, isFinal, primaryTranscript: transcripts[0] ?? '', alternatives: transcripts });
      this.onresult?.({ resultIndex: index, results: this.results });
    }

    inject(text) {
      this.results = [this.makeResult(text, true)];
      const transcripts = (Array.isArray(text) ? text : [text]).map(candidate => String(candidate?.transcript ?? candidate ?? ''));
      this.record('result', { resultIndex: 0, isFinal: true, primaryTranscript: transcripts[0] ?? '', alternatives: transcripts });
      this.onresult?.({ resultIndex: 0, results: this.results });
    }

    emitFinal(text) {
      this.emitResult(text, true);
    }

    emitInterim(text) {
      this.emitResult(text, false);
    }

    injectError(error = 'network') {
      this.emitError(error);
    }

    emitError(error = 'network') {
      this.lifecycleState = 'error';
      this.record('error', { error });
      this.onerror?.({ error });
    }

    emitEnd() {
      const duplicate = this.lifecycleState === 'ended';
      this.lifecycleState = 'ended';
      this.record(duplicate ? 'duplicate-end' : 'end');
      this.onend?.();
    }
  }

  Object.defineProperty(window, 'SpeechRecognition', { value: enabled ? MockRecognition : undefined, configurable: true });
  if (!enabled) Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
}
