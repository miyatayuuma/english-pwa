import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const manifest = readJson('manifest.json');
const surfaces = readJson('surface-inventory.json').eligible_target_sites;
const candidates = readJson('candidates.json').candidates;
const safe = readJson('safe.json').candidates;
const review = readJson('review.json').candidates;
const rejected = readJson('rejected.json').candidate_ids;
const overrides = readJson('existing-audit-overrides.json').overrides;
const vocab = readJson('../../vocabulary-v3.json').entries;
const closed = readJson('../vocabulary-word-final-consonant-asr/candidates.json').candidates;
const entryById = new Map(vocab.map((x) => [x.id, x]));
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const phones = (x) => String(x || '').trim().split(/\s+/).filter(Boolean);
const vowelBases = new Set(['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW']);
const isVowel = (p) => vowelBases.has(String(p || '').replace(/[012]$/, ''));
const words = (s) => {
  const out = [];
  const re = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
  let m;
  while ((m = re.exec(s || ''))) out.push(m[0].toLowerCase().replace(/’/g, "'"));
  return out;
};
const isExistingMatch = (c) => {
  const target = phones(c.target_pronunciation);
  const reduced = phones(c.resulting_pronunciation);
  return target.length >= 3 && ['T','D'].includes(target.at(-1)) && !isVowel(target.at(-2)) &&
    reduced.length === target.length - 1 && target.slice(0,-1).join(' ') === reduced.join(' ') &&
    String(c.following_context).toLowerCase() === 'to' && c.following_initial_phone === '/t/';
};
const ids = candidates.map((x) => x.candidate_id);
const safeIds = safe.map((x) => x.candidate_id);
const reviewIds = review.map((x) => x.candidate_id);
const keySet = candidates.map((x) => x.candidate_key);
check('immutable base and source authorities', () => {
  assert.equal(manifest.immutable_base_commit, '7ba04b6e11b18950f4dbcf9526350be524a599eb');
  assert.equal(manifest.parent_commit, manifest.immutable_base_commit);
  assert.equal(manifest.current_main_at_recovery, '22d4f37b48177b9a42a4b215330f0d7231400779');
});
check('eligible target sites reproduce 102', () => {
  assert.equal(surfaces.length, 102);
  assert.equal(surfaces.filter((x) => x.surface_type !== 'paraphrase').length, 69);
  assert.equal(surfaces.filter((x) => x.surface_type === 'paraphrase').length, 33);
  const keys = surfaces.map((x) => x.surface_ref + '|' + x.target_word_index);
  assert.equal(new Set(keys).size, keys.length);
});
check('existing candidate extraction reproduces 41', () => {
  const expectedIds = closed.filter(isExistingMatch).map((x) => x.candidate_id).sort();
  const actualIds = candidates.filter((x) => x.source_kind === 'existing_closed_audit').map((x) => x.candidate_id).sort();
  assert.equal(expectedIds.length, 41);
  assert.deepEqual(actualIds, expectedIds);
});
check('paraphrase candidate population reproduces 14', () => {
  const derived = candidates.filter((x) => x.source_kind === 'accepted_paraphrase');
  assert.equal(derived.length, 14);
  for (const c of derived) {
    assert.equal(c.surface_type, 'paraphrase');
    const e = entryById.get(c.entry_id);
    assert.ok(e);
    const idx = Number(c.accepted_surface_provenance.field.match(/\[(\d+)\]/)?.[1]);
    assert.equal(e.paraphrases[idx], c.target_surface);
  }
});
check('candidate IDs and generation keys are unique', () => {
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(keySet).size, keySet.length);
  assert.equal(candidates.length, 55);
});
check('SAFE REVIEW REJECT sets partition all candidates', () => {
  assert.equal(safe.length, 36);
  assert.equal(review.length, 0);
  assert.equal(rejected.length, 19);
  const all = [...safeIds, ...reviewIds, ...rejected];
  assert.equal(new Set(all).size, candidates.length);
  assert.deepEqual(all.slice().sort(), ids.slice().sort());
});
check('all SAFE phone paths are a single final /t,d/ deletion before to', () => {
  for (const c of safe) {
    assert.equal(String(c.following_context).toLowerCase(), 'to', c.candidate_id);
    assert.equal(c.following_initial_phone, '/t/', c.candidate_id);
    const paths = c.phonetic_paths?.length ? c.phonetic_paths : [{
      target_pronunciation: c.target_pronunciation,
      resulting_pronunciation: c.resulting_pronunciation,
      collision_pronunciation: c.collision_pronunciation,
      deleted_consonant: c.deleted_consonant
    }];
    assert.ok(paths.length > 0);
    for (const p of paths) {
      const target = phones(p.target_pronunciation);
      const reduced = phones(p.resulting_pronunciation);
      assert.ok(target.length >= 3);
      assert.ok(['T','D'].includes(target.at(-1)));
      assert.ok(!isVowel(target.at(-2)));
      assert.equal(target.slice(0,-1).join(' '), reduced.join(' '));
      assert.equal(target.length - reduced.length, 1);
      assert.equal(p.deleted_consonant, target.at(-1));
      assert.equal(p.collision_pronunciation, p.resulting_pronunciation);
      const targetVowels = target.filter(isVowel);
      const reducedVowels = reduced.filter(isVowel);
      assert.deepEqual(reducedVowels, targetVowels);
    }
  }
});
check('SAFE target and recognized surfaces differ only at the target word', () => {
  for (const c of safe) {
    const target = words(c.target_surface);
    const recognized = words(c.asr_surface);
    const i = c.target_word_index;
    assert.equal(target.length, recognized.length, c.candidate_id);
    assert.equal(target[i], String(c.target_word).toLowerCase().replace(/’/g, "'"), c.candidate_id);
    assert.equal(recognized[i], String(c.collision_word).toLowerCase(), c.candidate_id);
    assert.equal(target[i + 1], 'to', c.candidate_id);
    for (let n = 0; n < target.length; n++) if (n !== i) assert.equal(target[n], recognized[n], c.candidate_id);
  }
});
check('prior SAFE set retained and old REJECT promotions are sourced', () => {
  const retained = candidates.filter((x) => x.source_kind === 'existing_closed_audit' && x.original_decision === 'SAFE' && x.decision === 'SAFE');
  assert.equal(retained.length, 8);
  assert.equal(overrides.length, 17);
  assert.ok(overrides.every((x) => x.old_decision === 'REJECT' && x.new_decision === 'SAFE'));
  const overrideIds = new Set(overrides.map((x) => x.candidate_id));
  assert.equal(overrideIds.size, 17);
  for (const id of overrideIds) {
    const c = candidates.find((x) => x.candidate_id === id);
    assert.ok(c && c.source_kind === 'existing_closed_audit' && c.original_decision === 'REJECT' && c.decision === 'SAFE');
  }
});
check('mandatory canonical and source tend-to cases are SAFE', () => {
  const canonical = candidates.find((x) => x.entry_id === 'vocab:00502' && x.surface_ref === 'vocab:00502:canonical' && x.target_surface === 'tend to do something' && x.collision_word === 'ten');
  const source = candidates.find((x) => x.entry_id === 'vocab:00502' && x.surface_ref === 'vocab:00502:source:0' && x.target_surface === 'tend to associate politicians with hypocrisy' && x.collision_word === 'ten');
  assert.equal(canonical?.asr_surface, 'ten to do something');
  assert.equal(source?.asr_surface, 'ten to associate politicians with hypocrisy');
  assert.equal(canonical?.decision, 'SAFE');
  assert.equal(source?.decision, 'SAFE');
});
check('negative controls are absent from SAFE', () => {
  assert.ok(!safe.some((x) => x.target_word === 'apt' && x.collision_word === 'up'));
  assert.ok(!safe.some((x) => x.target_word === 'see' && x.collision_word === 'say'));
  assert.ok(!safe.some((x) => x.target_word === 'yield' && x.collision_word === 'yelled'));
});
check('production boundary and current-main drift check are explicit', () => {
  assert.deepEqual(manifest.production_boundary.changed_files, []);
  assert.equal(manifest.production_boundary.production_changes, 0);
  assert.equal(manifest.production_boundary.pr306_changes, 0);
  assert.equal(manifest.production_boundary.pr307_changes, 0);
  assert.equal(manifest.production_boundary.main_rebase, false);
  assert.equal(manifest.current_main_compatibility.drift_check_required_before_production, true);
});
check('reproduction checksum matches without adjustment', () => {
  assert.equal(manifest.status, 'REPRODUCED');
  assert.deepEqual(manifest.actual_result, manifest.prior_expected_result);
});
check('historical and paraphrase decision components reproduce', () => {
  const old = candidates.filter((x) => x.source_kind === 'existing_closed_audit');
  const derived = candidates.filter((x) => x.source_kind === 'accepted_paraphrase');
  assert.equal(old.filter((x) => x.original_decision === 'SAFE' && x.decision === 'SAFE').length, 8);
  assert.equal(overrides.length, 17);
  assert.equal(derived.filter((x) => x.decision === 'SAFE').length, 11);
  assert.equal(derived.filter((x) => x.decision === 'REJECT').length, 3);
  assert.equal(old.filter((x) => x.original_decision === 'REJECT' && x.decision === 'REJECT').length, 16);
});
check('rejected records are explained and fully accounted', () => {
  const rejects = candidates.filter((x) => x.decision === 'REJECT');
  assert.equal(rejects.length, 19);
  assert.ok(rejects.every((x) => x.reason && x.source_kind));
});
console.log('PASS: ' + checks.length + ' addendum validation checks');
for (const name of checks) console.log('- ' + name);
