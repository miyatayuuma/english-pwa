import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AndroidSpeechRecognizerBackend, selectRecognitionBackend } from '../scripts/native/androidSpeechBackend.js';
import { createRecognitionController } from '../scripts/speech/recognition.js';

const drivers = [];
afterEach(() => { for (const driver of drivers.splice(0)) driver.finish(); });
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture({ available = true, granted = true, permission, startError } = {}) {
  const calls = [];
  let callback;
  const plugin = {
    isAvailable: async () => ({ available, apiLevel: 35 }),
    requestPermission: async () => permission ? permission : { granted },
    addListener: async (_event, listener) => { callback = listener; return { remove: async () => calls.push(['remove']) }; },
    start: async options => { calls.push(['start', options]); if (startError) throw startError; },
    stop: async options => calls.push(['stop', options]),
    cancel: async options => calls.push(['cancel', options]),
  };
  const make = () => {
    const driver = new AndroidSpeechRecognizerBackend({ pluginProvider: async () => plugin });
    driver.context = { itemId: 'E0001' };
    drivers.push(driver);
    return driver;
  };
  const emit = (driver, type, alternatives = [], sessionId = driver.sessionId) => callback({ sessionId, type, alternatives });
  return { make, emit, calls, plugin };
}

test('routing selects native only for the actual Android shell and excludes Reordering', () => {
  class Web {}
  const scope = { window: { SpeechRecognition: Web }, navigator: { userAgent: 'Android' } };
  assert.equal(selectRecognitionBackend(scope), Web);
  scope.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
  assert.equal(selectRecognitionBackend(scope), AndroidSpeechRecognizerBackend);
  for (const mode of ['compose', 'generate', 'reorder']) assert.equal(selectRecognitionBackend(scope, mode), null);
  scope.Capacitor.getPlatform = () => 'ios';
  assert.equal(selectRecognitionBackend(scope), Web);
});

test('native start passes only session identity, preserves ranked final-only evidence and ignores stale callbacks', async () => {
  const f = fixture();
  const driver = f.make();
  const results = [];
  let starts = 0, ends = 0;
  driver.onresult = result => results.push(result);
  driver.onstart = () => starts++;
  driver.onend = () => ends++;
  driver.start();
  await driver.startup;
  assert.deepEqual(f.calls[0][1], { sessionId: driver.sessionId });
  f.emit(driver, 'ready'); f.emit(driver, 'started');
  assert.equal(starts, 1);
  f.emit(driver, 'partial', [{ transcript: 'stale' }], 'old-session');
  assert.equal(results.length, 0);
  f.emit(driver, 'final', [{ transcript: 'YouTube', confidence: 0.8 }, { transcript: 'yield to something' }]);
  assert.equal(results[0].results[0].isFinal, true);
  assert.equal(results[0].results[0][0].transcript, 'YouTube');
  assert.equal(results[0].results[0][1].confidence, null);
  f.emit(driver, 'end'); f.emit(driver, 'end');
  assert.equal(ends, 1);
  assert.equal(f.calls.filter(x => x[0] === 'remove').length, 1);
});

test('double start and cross-controller start are blocked until a stopped session receives final/error', async () => {
  const f = fixture();
  const driver = f.make();
  driver.start(); await driver.startup;
  assert.throws(() => driver.start(), /busy/);
  const next = f.make();
  assert.throws(() => next.start(), /busy/);
  driver.stop(); driver.stop(); await turn();
  assert.equal(driver.state, 'stopping');
  assert.equal(f.calls.filter(x => x[0] === 'stop').length, 1);
  assert.throws(() => next.start(), /busy/);
  f.emit(driver, 'final', [{ transcript: 'done' }]);
  f.emit(driver, 'end');
  next.start(); await next.startup;
  assert.notEqual(next.sessionId, driver.sessionId);
  f.emit(next, 'end');
});

for (const failure of [{ available: false, code: 'UNAVAILABLE' }, { granted: false, code: 'PERMISSION_DENIED' }, { startError: Object.assign(new Error('provider error'), { code: 'PROVIDER' }), code: 'PROVIDER' }]) {
  test(`native ${failure.code} is explicit, ends once, and does not silently use Web`, async () => {
    const f = fixture(failure), driver = f.make();
    const errors = []; let ends = 0;
    driver.onerror = error => errors.push(error.error); driver.onend = () => ends++;
    driver.start(); await driver.startup;
    assert.deepEqual(errors, [failure.code]); assert.equal(ends, 1); assert.equal(driver.state, 'idle');
  });
}

test('cancel during pending permission never creates a native recognizer', async () => {
  let grant;
  const permission = new Promise(resolve => { grant = resolve; });
  const f = fixture({ permission }), driver = f.make();
  driver.start(); await turn(); driver.abort(); grant({ granted: true }); await driver.startup;
  assert.equal(f.calls.filter(x => x[0] === 'start').length, 0);
  assert.equal(driver.state, 'idle');
});

test('cancel tears down active session once and late native results cannot escape', async () => {
  const f = fixture(), driver = f.make(); let results = 0;
  driver.onresult = () => results++;
  driver.start(); await driver.startup;
  driver.abort(); driver.abort(); await turn();
  assert.equal(f.calls.filter(x => x[0] === 'cancel').length, 1);
  f.emit(driver, 'final', [{ transcript: 'late' }]);
  assert.equal(results, 0);
});

test('production controller manual native stop waits for final and preserves common N-best schema', async () => {
  const f = fixture(); let driver;
  class Backend extends AndroidSpeechRecognizerBackend {
    constructor() { super({ pluginProvider: async () => f.plugin }); driver = this; drivers.push(this); }
  }
  const controller = createRecognitionController({ recognitionBackend: Backend });
  assert.equal(controller.start().ok, true); await driver.startup;
  let settled = false;
  const promise = controller.stop().then(result => { settled = true; return result; });
  await turn(); assert.equal(settled, false); assert.equal(controller.isActive(), true);
  f.emit(driver, 'final', [{ transcript: 'YouTube' }, { transcript: 'yield to something' }]);
  f.emit(driver, 'end');
  const result = await promise;
  assert.equal(result.transcript, 'YouTube');
  assert.deepEqual(result.recognitionSegments[0].alternatives.map(c => c.asrRank), [0, 1]);
  assert.equal(result.recognitionSegments[0].isFinal, true);
  assert.equal(controller.isActive(), false);
});

test('native error and cancellation settle pending manual stop without grading partial speech', async () => {
  for (const cancel of [false, true]) {
    const f = fixture(); let driver, errors = 0, grades = 0;
    class Backend extends AndroidSpeechRecognizerBackend { constructor() { super({ pluginProvider: async () => f.plugin }); driver = this; drivers.push(this); } }
    const controller = createRecognitionController({ recognitionBackend: Backend, onError: () => errors++, onAutoStop: () => grades++ });
    controller.start(); await driver.startup;
    f.emit(driver, 'partial', [{ transcript: 'I' }]);
    const promise = controller.stop();
    if (cancel) controller.cancel(); else f.emit(driver, 'error');
    assert.equal((await promise).ok, false); assert.equal(grades, 0);
    assert.equal(errors, cancel ? 0 : 1); await turn();
  }
});

test('native production controller retains all twenty original provider candidates and exports counts',async()=>{
  const f=fixture();let driver;
  class Backend extends AndroidSpeechRecognizerBackend{constructor(){super({pluginProvider:async()=>f.plugin});driver=this;drivers.push(this);}}
  const controller=createRecognitionController({recognitionBackend:Backend});
  controller.start();await driver.startup;
  assert.equal(driver.maxAlternatives,20);
  const values=Array.from({length:20},(_,i)=>({transcript:i===19?'yell':i<2?'yeah':i===2?'':'wrong '+i,asrRank:i,confidence:0.05}));
  f.emit(driver,'final',values);
  const segment=controller.getRecognitionSegments()[0];
  assert.equal(segment.alternatives.length,20);
  assert.equal(segment.alternatives[2].transcript,'');
  assert.equal(segment.alternatives.at(-1).asrRank,19);
  assert.equal(segment.alternatives.at(-1).transcript,'yell');
  assert.equal(segment.providerReturnedCount,20);
  assert.equal(segment.retainedCandidateCount,20);
  assert.equal(segment.requestedMaxResults,20);
  controller.cancel();await turn();
});

for(const rank of [6,12,20]) test(`Android adapter/controller uses shared TARGET rescue at provider rank ${rank}`,async()=>{
  const {classifyVocabularySpeechAnswer}=await import('../scripts/speech/vocabularySpeechEvidence.js');
  const f=fixture();let driver;
  class Backend extends AndroidSpeechRecognizerBackend{constructor(){super({pluginProvider:async()=>f.plugin});driver=this;drivers.push(this);}}
  const controller=createRecognitionController({recognitionBackend:Backend});
  controller.start();await driver.startup;
  const promise=controller.stop();
  f.emit(driver,'final',Array.from({length:20},(_,i)=>({transcript:i===rank-1?'yell':'yeah',asrRank:i,confidence:0})));
  f.emit(driver,'end');const result=await promise;
  const grade=classifyVocabularySpeechAnswer({entry:{canonical:'yell'},...result});
  assert.equal(grade.type,'target');assert.equal(grade.recognitionAuthority,'nbest-exact');
  assert.equal(grade.asrRank,rank-1);assert.equal(result.recognitionSegments[0].alternatives.length,20);
});

test('Android provider evidence reaches shared curated Vocabulary chunk rescue at retained N-best rank',async()=>{
  const {classifyVocabularySpeechAnswer}=await import('../scripts/speech/vocabularySpeechEvidence.js');
  const f=fixture();let driver;
  class Backend extends AndroidSpeechRecognizerBackend{constructor(){super({pluginProvider:async()=>f.plugin});driver=this;drivers.push(this);}}
  const controller=createRecognitionController({recognitionBackend:Backend});
  controller.start();await driver.startup;
  const primary='no sooner had I arrived then the phone rang';
  const alternatives=Array.from({length:20},(_,index)=>({
    transcript:index===0?primary:index===19?'than the phone rang':`unrelated ${index}`,
    asrRank:index,
    confidence:0,
  }));
  const promise=controller.stop();
  f.emit(driver,'final',alternatives);f.emit(driver,'end');
  const evidence=await promise;
  const grade=classifyVocabularySpeechAnswer({
    entry:{id:'vocab:00139',canonical:'no sooner had I arrived than the phone rang'},
    ...evidence,
  });
  assert.equal(grade.type,'target');
  assert.equal(grade.recognitionAuthority,'nbest-chunk-exact');
  assert.equal(grade.asrRank,19);
  assert.equal(grade.primaryTranscript,primary);
  assert.equal(grade.displayTranscript,primary);
  assert.equal(evidence.recognitionSegments[0].alternatives.length,20);
  assert.equal(evidence.recognitionSegments[0].alternatives[19].transcript,'than the phone rang');
});
