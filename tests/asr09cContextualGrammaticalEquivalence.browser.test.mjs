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
      const extension = path.extname(filename);
      const type = extension === '.html' ? 'text/html; charset=utf-8'
        : extension === '.json' ? 'application/json; charset=utf-8'
          : extension === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
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
  } catch (error) {
    if (process.env.REORDER_REQUIRE_BROWSER) throw error;
    browserError = `local test server unavailable: ${error?.code || error?.message || error}`;
    return;
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
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

test('Chromium executes contextual ASR-09C matching and keeps the runtime mode boundary', { skip: () => !!browserError }, async () => {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/index.html`);
  const result = await page.evaluate(async () => {
    const alignment = await import('/scripts/speech/speechAlignment.js');
    const vocabulary = await import('/scripts/speech/vocabularySpeechEvidence.js');
    const positive = alignment.findSpeechSurfaceMatch('She has been studying.', "She’s been studying.", {
      context: { mode: 'correction' }, attemptId: 'chromium-asr09c', recognitionSegmentIndex: 9, asrRank: 1,
    });
    const negative = alignment.findSpeechSurfaceMatch('He is finished.', "He's finished.", {
      context: { mode: 'vocabulary' },
    });
    const read = alignment.findSpeechSurfaceMatch('He is working.', "He's working.", {
      context: { mode: 'read' },
    });
    const fixedRead = alignment.findSpeechSurfaceMatch('I am ready.', "I'm ready.", {
      context: { mode: 'read' },
    });
    const target = vocabulary.classifyVocabularySpeechAnswer({
      entry: { id: 'browser-asr09c', canonical: 'He is working.' },
      transcript: "He's working.",
    });
    return {
      positive: positive && {
        authority: positive.authority,
        ruleId: positive.ruleId,
        selectedAuxiliary: positive.selectedAuxiliary,
        decisionId: positive.decisionId,
        attemptId: positive.attemptId,
        recognitionSegmentIndex: positive.recognitionSegmentIndex,
        asrRank: positive.asrRank,
        rawTranscript: positive.rawTranscript,
      },
      negative,
      read,
      fixedRead: fixedRead?.decisionId,
      target: { type: target.type, authority: target.recognitionAuthority, rawTranscript: target.rawTranscript },
    };
  });
  assert.deepEqual(result.positive, {
    authority: 'grammatical-variant',
    ruleId: 'asr09c-has-been-progressive',
    selectedAuxiliary: 'has',
    decisionId: 'ambiguous-s',
    attemptId: 'chromium-asr09c',
    recognitionSegmentIndex: 9,
    asrRank: 1,
    rawTranscript: "She’s been studying.",
  });
  assert.equal(result.negative, null);
  assert.equal(result.read, null);
  assert.equal(result.fixedRead, 'fixed-be-have-will');
  assert.deepEqual(result.target, { type: 'target', authority: 'grammatical-variant', rawTranscript: "He's working." });
  await page.close();
});
