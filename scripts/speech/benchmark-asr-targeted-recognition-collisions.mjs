import { performance } from 'node:perf_hooks';
import { alignSpeech, findSpeechSurfaceMatch } from './speechAlignment.js';

const workloads = [
  {
    name: 'exact-surface',
    run: () => findSpeechSurfaceMatch('The result is ready now.', 'The result is ready now.', { context: { mode: 'vocabulary' } }),
  },
  {
    name: 'approved-homophone',
    run: () => findSpeechSurfaceMatch('prose', 'pros', { context: { mode: 'read' } }),
  },
  {
    name: 'gaze-gays',
    run: () => findSpeechSurfaceMatch('gaze at something', 'gays at something', { context: { mode: 'vocabulary', entryId: 'vocab:01156' } }),
  },
  {
    name: 'lack-black-authorized',
    run: () => findSpeechSurfaceMatch('lack of something', 'black of something', { context: { mode: 'vocabulary', entryId: 'vocab:01296' } }),
  },
  {
    name: 'lack-black-wrong-entry',
    run: () => findSpeechSurfaceMatch('lack', 'black', { context: { mode: 'vocabulary', entryId: 'vocab:00025' } }),
  },
  {
    name: 'lack-black-read-cloze-negative',
    run: () => {
      findSpeechSurfaceMatch('lack', 'black', { context: { mode: 'read', entryId: 'vocab:01251' } });
      return findSpeechSurfaceMatch('lack', 'black', { context: { mode: 'cloze', entryId: 'vocab:01251' } });
    },
  },
  {
    name: 'sentence-alignment',
    run: () => alignSpeech(
      'The prose survived the postwar years after the storm.',
      'The pros survived the post war years after the storm.',
      { context: { mode: 'read' } },
    ),
  },
];

const sampleCount = Number(process.env.BENCHMARK_SAMPLES || 80);
const iterationsPerSample = Number(process.env.BENCHMARK_ITERATIONS || 100);
const percentile = (sorted, value) => sorted[Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1)];
const report = {};

for (const workload of workloads) {
  for (let warmup = 0; warmup < 500; warmup += 1) workload.run();
  const samples = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = performance.now();
    for (let iteration = 0; iteration < iterationsPerSample; iteration += 1) workload.run();
    samples.push((performance.now() - started) / iterationsPerSample);
  }
  samples.sort((left, right) => left - right);
  report[workload.name] = {
    iterations: sampleCount * iterationsPerSample,
    p50MsPerCall: Number(percentile(samples, 0.5).toFixed(6)),
    p95MsPerCall: Number(percentile(samples, 0.95).toFixed(6)),
  };
}

console.log(JSON.stringify({ sampleCount, iterationsPerSample, workloads: report }, null, 2));
