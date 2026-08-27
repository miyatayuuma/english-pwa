import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../scripts/version.js',import.meta.url),'utf8');

test('character and skill browser waits for session shell readiness',()=>{
  const sessionImport=source.indexOf("await import('./app/sessionShell.js')");
  const readyEvent=source.indexOf("english-pwa:session-shell-ready");
  const browserImport=source.indexOf("await import('./app/tagBrowser.js')");

  assert.ok(sessionImport>=0,'session shell import must exist');
  assert.ok(readyEvent>sessionImport,'readiness gate must follow the session shell import');
  assert.ok(browserImport>readyEvent,'tag browser must load only after the readiness gate');
  assert.equal(source.includes("import('./app/tagBrowser.js').catch"),false,'parallel tag browser import must not return');
});
