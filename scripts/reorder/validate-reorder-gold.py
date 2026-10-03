#!/usr/bin/env python3
"""Fresh-parser replay of the frozen human sample and all repair dispositions."""
import importlib.util
import json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('shared_generator',root/'scripts/reorder/generate-reorder-metadata.py')
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
load=lambda p:json.loads((root/p).read_text())
gold=load('data/reorder-gold.json');items={i['id']:i['en'] for i in load('data/items.json')}
metadata=load('data/reorder-v1.json');overrides=load('data/reorder-overrides.json')['items']
by_key={(i['itemId'],s['sentenceIndex']):s for i in metadata['items'] for s in i['sentences']}
nlp=g.spacy.load('en_core_web_sm');parsed={};errors=[]
assert g.spacy.__version__=='3.8.16' and nlp.meta['version']=='3.8.0'
assert len(gold['reviewedSample'])==126 and len(gold['humanRepairs'])==79 and len(gold['overrideMigration'])==18
for r in gold['reviewedSample']+gold['humanRepairs']:
    key=(r['itemId'],r['sentenceIndex']);source=items[key[0]]
    if r.get('sourceHash') and r['sourceHash']!=g.sha256(source):errors.append(f'{key}: stale gold source')
    if key[0] not in parsed:parsed[key[0]]=g.sentence_spans(nlp(source))
    span=parsed[key[0]][key[1]]
    if span.text!=r['sourceText']:errors.append(f'{key}: source drift')
    override=overrides.get(key[0],{}).get('sentences',{}).get(str(key[1]),{})
    entry=g.make_sentence(key[0],source,span,key[1],override,g.punctuation_classes(source))
    expected=r['expectedLearningChunks']
    if [c['learningText'] for c in entry['partition']['chunks']]!=expected:errors.append(f'{key}: fresh-parser regression')
    if [c['learningText'] for c in by_key[key]['partition']['chunks']]!=expected:errors.append(f'{key}: artifact regression')
    if r.get('prototypeLearningChunks')!=expected and not r['assessment']:errors.append(f'{key}: unexplained difference')
    if r.get('category')=='D' and not override.get('learningChunks'):errors.append(f'{key}: missing explicit override')
# Consumer-neutral learning surface contract and future UTF-16 serialization.
for source,expected in [('\"No,\" he said, \"I don\'t know.\"',"No he said I don't know"),
                        ("John's O'Brien well-known U.S. Ms. 22.68 1,000 5:00 $100 10% his/her!", "John's O'Brien well-known U.S. Ms. 22.68 1,000 5:00 $100 10% his/her"),
                        ("the hearts' wishes", "the hearts' wishes"),
                        ("An 'instrument' is useful.","An instrument is useful")]:
    assert g.learning_surface(source,0,len(source),g.punctuation_classes(source))==expected,source
assert g.utf16('A𝒜B',2)==3
assert g.learning_surface('The NASA I',0,10,g.punctuation_classes('The NASA I'))=='The NASA I'
try:g.punctuation_classes('unknown @ symbol')
except ValueError:pass
else:raise AssertionError('unknown punctuation must fail closed')
if errors:raise SystemExit('\n'.join(errors))
print('126 reviewed sentences + 79 classified repairs + 18 override migrations: fresh-parser PASS')
