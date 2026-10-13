import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let browser;
let baseUrl = '';
let browserError = '';

before(async () => {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
      const filename = path.resolve(ROOT, `.${pathname}`);
      if (!filename.startsWith(`${ROOT}${path.sep}`) && filename !== ROOT) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(filename);
      const type = path.extname(filename) === '.html' ? 'text/html; charset=utf-8'
        : path.extname(filename) === '.json' ? 'application/json; charset=utf-8'
        : path.extname(filename) === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
      response.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*' }).end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, timeout: 5000 });
  } catch (error) {
    if (process.env.REORDER_REQUIRE_BROWSER) throw error;
    browserError = String(error?.message ?? error).split('\n')[0];
  }
});

after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

test('Chromium executes bounded ASR-09D matching and preserves its Vocabulary/Correction scope', { skip: () => !!browserError }, async () => {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/index.html`);
  const result = await page.evaluate(async () => {
    const speech = await import('/scripts/speech/speechAlignment.js');
    const vocabulary = await import('/scripts/speech/vocabularySpeechEvidence.js');
    const had = speech.findSpeechSurfaceMatch('I had eaten.', 'I’d eaten.', {
      context: { mode: 'correction' }, attemptId: 'chromium-asr09d', recognitionSegmentIndex: 4, asrRank: 1,
    });
    const would = speech.findSpeechSurfaceMatch('They would speak.', 'They’d speak.', { context: { mode: 'vocabulary' } });
    const ambiguous = speech.findSpeechSurfaceMatch('I would put it there.', 'I’d put it there.', { context: { mode: 'vocabulary' } });
    const read = speech.findSpeechSurfaceMatch('I would go.', 'I’d go.', { context: { mode: 'read' } });
    const fixed = speech.findSpeechSurfaceMatch('I am ready.', 'I’m ready.', { context: { mode: 'read' } });
    const target = vocabulary.classifyVocabularySpeechAnswer({
      entry: { id: 'asr09d-browser', canonical: 'I had eaten.' }, transcript: 'I’d eaten.',
    });
    return {
      had: had && { selectedAuxiliary: had.selectedAuxiliary, decisionId: had.decisionId, attemptId: had.attemptId, asrRank: had.asrRank, rawTranscript: had.rawTranscript },
      would: would?.selectedAuxiliary,
      ambiguous,
      read,
      fixed: fixed?.decisionId,
      target: { type: target.type, decisionId: target.decisionId, rawTranscript: target.rawTranscript },
    };
  });
  assert.deepEqual(result.had, { selectedAuxiliary: 'had', decisionId: 'ambiguous-d', attemptId: 'chromium-asr09d', asrRank: 1, rawTranscript: 'I’d eaten.' });
  assert.equal(result.would, 'would');
  assert.equal(result.ambiguous, null);
  assert.equal(result.read, null);
  assert.equal(result.fixed, 'fixed-be-have-will');
  assert.deepEqual(result.target, { type: 'target', decisionId: 'ambiguous-d', rawTranscript: 'I’d eaten.' });
  await page.close();
});
