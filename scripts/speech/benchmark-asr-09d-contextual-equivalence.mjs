import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index].startsWith('--')) args.set(process.argv[index], process.argv[++index]);
}
const baselineRoot = path.resolve(args.get('--baseline') || '/tmp/english-pwa-asr09d-baseline');
const baselineRevision = args.get('--baseline-sha') || '1e613b1020d77031e1d7f59ed342c416867da383';
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(git.status, 0, 'benchmark must run in a git checkout');
const candidateRevision = args.get('--candidate-sha') || git.stdout.trim();
assert.ok(fs.existsSync(path.join(baselineRoot, 'scripts/speech/speechAlignment.js')), `baseline checkout missing: ${baselineRoot}`);
const loadAlignment = async root => import(pathToFileURL(path.join(root, 'scripts/speech/speechAlignment.js')).href);
const baseline = await loadAlignment(baselineRoot);
const candidate = await loadAlignment(ROOT);

const workloads = [
  { workload: 'exact phrase surface lookup', api: 'findSpeechSurfaceMatch', iterations: 3000, run: api => api.findSpeechSurfaceMatch('I am ready for it.', 'I am ready for it.', { context: { mode: 'vocabulary' } }) },
  { workload: 'ASR-09B fixed equivalence', api: 'findSpeechSurfaceMatch', iterations: 3000, run: api => api.findSpeechSurfaceMatch('I am ready.', "I'm ready.", { context: { mode: 'vocabulary' } }) },
  { workload: "ASR-09C contextual 's", api: 'findSpeechSurfaceMatch', iterations: 3000, run: api => api.findSpeechSurfaceMatch('He is working.', "He's working.", { context: { mode: 'vocabulary' } }) },
  { workload: 'ASR-09D unique HAD positive', api: 'findSpeechSurfaceMatch', iterations: 3000, run: api => api.findSpeechSurfaceMatch('I had eaten.', "I'd eaten.", { context: { mode: 'vocabulary' } }) },
  { workload: 'ASR-09D ambiguous negative', api: 'findSpeechSurfaceMatch', iterations: 3000, run: api => api.findSpeechSurfaceMatch('I would put it there.', "I'd put it there.", { context: { mode: 'vocabulary' } }) },
  { workload: 'sentence alignment with two D spans', api: 'alignSpeech', iterations: 60, run: api => api.alignSpeech('She said I had eaten, and they had gone home.', 'She said I’d eaten, and they’d gone home.', { context: { mode: 'vocabulary' } }) },
];

const trials = 31;
const warmups = 2000;
for (const workload of workloads) {
  const api = workload.api === 'alignSpeech' ? 'alignSpeech' : 'findSpeechSurfaceMatch';
  for (let index = 0; index < warmups; index += 1) {
    workload.run(baseline);
    workload.run(candidate);
  }
  workload._api = api;
}

function nearestRank(values, percentile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}
function measure(fn, count) {
  const start = performance.now();
  for (let index = 0; index < count; index += 1) fn();
  return (performance.now() - start) / count;
}

const results = [];
for (const workload of workloads) {
  const baselineMs = [];
  const candidateMs = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const reverse = trial % 2 === 1;
    const first = measure(() => workload.run(reverse ? candidate : baseline), workload.iterations);
    const second = measure(() => workload.run(reverse ? baseline : candidate), workload.iterations);
    if (reverse) { candidateMs.push(first); baselineMs.push(second); }
    else { baselineMs.push(first); candidateMs.push(second); }
  }
  const baselineP50 = nearestRank(baselineMs, 0.5);
  const baselineP95 = nearestRank(baselineMs, 0.95);
  const candidateP50 = nearestRank(candidateMs, 0.5);
  const candidateP95 = nearestRank(candidateMs, 0.95);
  results.push({
    workload: workload.workload,
    api: workload._api,
    iterationsPerTrial: workload.iterations,
    baseline: { p50MsPerCall: Number(baselineP50.toFixed(6)), p95MsPerCall: Number(baselineP95.toFixed(6)) },
    candidate: { p50MsPerCall: Number(candidateP50.toFixed(6)), p95MsPerCall: Number(candidateP95.toFixed(6)) },
    p50DeltaPct: Number((((candidateP50 / baselineP50) - 1) * 100).toFixed(1)),
    p95DeltaPct: Number((((candidateP95 / baselineP95) - 1) * 100).toFixed(1)),
  });
}

const comparison = {
  schemaVersion: 1,
  baselineRevision,
  candidateRevision,
  measuredAt: new Date().toISOString(),
  method: {
    trials,
    warmupCallsPerApi: warmups,
    percentileMethod: 'nearest-rank',
    unit: 'milliseconds per call',
    order: 'alternating baseline/candidate within each trial',
    runtime: `Node ${process.version}`,
    platform: `${process.platform}/${process.arch}`,
    cpuModel: os.cpus()[0]?.model || 'unknown',
  },
  metricNames: ['p50MsPerCall', 'p95MsPerCall'],
  workloads: results,
};
const output = `${JSON.stringify(comparison, null, 2)}\n`;
const destination = path.join(ROOT, 'data/audits/asr-09d-contextual-grammatical-equivalence/performance-comparison.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, output);
console.log(output);
