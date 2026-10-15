import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Pixel acceptance tooling rejects unsafe devices, tampered APKs and private trace fields', () => {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const result=spawnSync('python3',['-B','-m','unittest','discover','-s','tools/pixel-acceptance','-p','test_kit.py'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
