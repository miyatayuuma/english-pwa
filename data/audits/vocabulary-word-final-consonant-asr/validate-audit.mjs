import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const manifest = readJson('manifest.json');
const surfaces = readJson('surface-inventory.json').surfaces;
const coda = readJson('coda-sites.json').sites;
const candidateDoc = readJson('candidates.json');
const safeDoc = readJson('safe.json');
const reviewDoc = readJson('review.json');
const rejectedDoc = readJson('rejected.json');
const registrationDoc = readJson('registration-candidates.json');
const controls = readJson('controls.json');
const vocabDoc = readJson('../../vocabulary-v3.json');
const itemsDoc = readJson('../../items.json');

const entries = vocabDoc.entries;
const itemById = new Map(itemsDoc.map((item) => [item.id, item]));
const entryById = new Map(entries.map((entry) => [entry.id, entry]));
const surfaceByRef = new Map(surfaces.map((surface) => [surface.surface_ref, surface]));
const candidates = candidateDoc.candidates;
const candidateById = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

check('population is 2,478', () => assert.equal(entries.length, 2478));
check('surface authority reconstructed exactly', () => {
  const expected = [];
  for (const entry of entries) {
    expected.push({ ref: entry.id + ':canonical', text: entry.canonical, type: 'canonical' });
    (entry.answers || []).forEach((answer, i) => expected.push({ ref: entry.id + ':answer:' + i, text: answer, type: 'answer' }));
    (entry.occurrences || []).forEach((occurrence, i) => {
      const item = itemById.get(occurrence.item_id);
      assert.ok(item, 'missing source item ' + occurrence.item_id);
      expected.push({ ref: entry.id + ':source:' + i, text: item.en.slice(occurrence.start, occurrence.end), type: 'source' });
    });
  }
  assert.equal(expected.length, 4970);
  const actual = surfaces.map((s) => ({ ref: s.surface_ref, text: s.target_surface, type: s.surface_type }));
  assert.deepEqual(new Set(actual.map((x) => x.ref)).size, actual.length);
  assert.deepEqual([...expected].sort((a,b) => a.ref.localeCompare(b.ref)), [...actual].sort((a,b) => a.ref.localeCompare(b.ref)));
});
check('all source spans reproduce their TARGET surface', () => {
  for (const s of surfaces.filter((x) => x.surface_type === 'source')) {
    const item = itemById.get(s.item_id);
    assert.equal(item.en.slice(s.source_span.start, s.source_span.end), s.target_surface);
  }
});
check('coda site coverage count', () => assert.equal(coda.length, 7870));
check('candidate IDs and identities are unique', () => {
  assert.equal(candidateById.size, candidates.length);
  const keys = candidates.map((c) => [c.surface_ref,c.target_word_index,c.reduction,c.collision_word].join('|'));
  assert.equal(new Set(keys).size, keys.length);
});
check('candidate TARGET references are valid', () => {
  for (const c of candidates) {
    assert.ok(entryById.has(c.entry_id), c.candidate_id + ' missing entry');
    const s = surfaceByRef.get(c.surface_ref);
    assert.ok(s, c.candidate_id + ' missing surface ref');
    assert.equal(s.entry_id, c.entry_id);
    assert.equal(s.target_surface, c.target_surface);
    assert.ok(coda.some((x) => x.coda_site_id === c.coda_site_ref), c.candidate_id + ' missing coda site');
  }
});
check('all candidate paths are exact one-final-consonant deletion', () => {
  for (const c of candidates) {
    const paths = c.phonetic_paths || [{
      target_pronunciation: c.target_pronunciation,
      coda: c.coda,
      deleted_consonant: c.reduction.match(/\/([a-z]+)\//i)[1].toUpperCase(),
      resulting_pronunciation: c.resulting_pronunciation,
      collision_pronunciation: c.collision_pronunciation
    }];
    for (const p of paths) {
      const target = p.target_pronunciation.split(' ');
      const reduced = p.resulting_pronunciation.split(' ');
      assert.equal(target.slice(0, -1).join(' '), reduced.join(' '));
      assert.equal(target.at(-1).replace(/[012]$/, ''), p.deleted_consonant);
      assert.equal(p.collision_pronunciation, p.resulting_pronunciation);
    }
  }
});
check('split decision sets partition all candidates', () => {
  const safe = safeDoc.candidates.map((x) => x.candidate_id);
  const review = reviewDoc.candidates.map((x) => x.candidate_id);
  const rejected = rejectedDoc.candidate_ids;
  assert.equal(new Set([...safe,...review,...rejected]).size, candidates.length);
  assert.deepEqual([...new Set([...safe,...review,...rejected])].sort(), candidates.map((x) => x.candidate_id).sort());
  assert.equal(safe.length, manifest.counts.SAFE);
  assert.equal(review.length, manifest.counts.REVIEW);
  assert.equal(rejected.length, manifest.counts.REJECT);
});
check('SAFE registration list equals SAFE audit records', () => {
  assert.deepEqual(registrationDoc.candidates.map((x) => x.candidate_id).sort(), safeDoc.candidates.map((x) => x.candidate_id).sort());
  assert.ok(registrationDoc.candidates.every((x) => x.decision === 'SAFE'));
});
check('apt to → app to seed is SAFE', () => {
  const seeds = candidates.filter((x) => x.entry_id === 'vocab:01166' && x.target_word === 'apt' && x.collision_word === 'app');
  assert.equal(seeds.length, 2);
  assert.ok(seeds.every((x) => x.decision === 'SAFE'));
});
check('apt to → up to is REJECT and absent from candidate generation', () => {
  const negative = controls.negative_controls.find((x) => x.target_fragment === 'apt to' && x.asr_fragment === 'up to');
  assert.equal(negative.decision, 'REJECT');
  assert.equal(negative.candidate_generated, false);
  assert.ok(!candidates.some((x) => x.target_word === 'apt' && x.collision_word === 'up'));
  assert.ok(!registrationDoc.candidates.some((x) => x.recognized_surface.toLowerCase().includes('up to')));
});
check('vowel-substitution controls are not SAFE', () => {
  assert.ok(!candidates.some((x) => x.decision === 'SAFE' && x.target_word === 'see' && x.collision_word === 'say'));
  assert.ok(!candidates.some((x) => x.decision === 'SAFE' && x.target_word === 'yield' && x.collision_word === 'yelled'));
});
check('every candidate classified', () => {
  assert.equal(candidates.filter((x) => ['SAFE','REVIEW','REJECT'].includes(x.decision)).length, candidates.length);
  assert.equal(manifest.counts.unclassified, 0);
});

console.log('PASS: ' + checks.length + ' audit validation checks');
for (const name of checks) console.log('- ' + name);
