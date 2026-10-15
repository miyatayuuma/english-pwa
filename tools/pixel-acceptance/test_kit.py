import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('kit', Path(__file__).with_name('kit.py'))
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)

class KitTests(unittest.TestCase):
    def test_missing_adb(self):
        with patch.object(kit.shutil, 'which', return_value=None):
            self.assertEqual(kit.preflight()['reason'], 'ADB_MISSING')

    def test_refuses_multiple_unauthorized_and_emulator(self):
        with patch.object(kit.shutil, 'which', return_value='/adb'):
            for rows in ['List of devices attached\nsecret unauthorized', 'List of devices attached\na device\nb device', 'List of devices attached\n']:
                with patch.object(kit, 'adb', return_value=rows):
                    self.assertEqual(kit.preflight()['status'], 'DEVICE_UNAVAILABLE')
            props = iter(['List of devices attached\nemulator-5554 device', 'Google', 'Pixel 9', '17', '37', '1'])
            with patch.object(kit, 'adb', side_effect=lambda _: next(props)):
                self.assertEqual(kit.preflight()['reason'], 'NOT_PHYSICAL_PIXEL')

    def test_pixel_read_only_and_serial_never_exported(self):
        outputs = iter(['List of devices attached\nPRIVATE_SERIAL device', 'Google', 'Pixel 9', '17', '37', ''])
        with patch.object(kit.shutil, 'which', return_value='/adb'), patch.object(kit, 'adb', side_effect=lambda _: next(outputs)) as call:
            result = kit.preflight()
            self.assertEqual(result['status'], 'PIXEL_DETECTED_PERMISSION_REQUIRED')
            self.assertNotIn('PRIVATE_SERIAL', json.dumps(result))
            self.assertTrue(all(c.args[0][0] in ('devices', 'shell') for c in call.call_args_list))

    def test_sanitizer_drops_unknown_nested_strings_and_uses_cumulative_count(self):
        raw = {'schemaVersion':'asr-game-trace-export-v1', 'serial':'SECRET', 'attempts':[{'attemptId':'SECRET', 'context':{'en':'SECRET'}, 'events':[
            {'type':'candidate-selected','alternatives':['SECRET'], 'selectedCandidateTranscript':'SECRET', 'selectedCandidateRank':2, 'ruleId':'SECRET', 'completionState':'SECRET'},
            {'type':'srs-update-completed', 'persistenceWriteCount':1, 'after':{'name':'SECRET'}},
            {'type':'srs-update-completed', 'persistenceWriteCount':1},
            {'type':'SECRET', 'score':50}]}]}
        result = kit.sanitize(raw)
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertEqual(result['attempts'][0]['srsWriteCount'],1)
        self.assertEqual(result['acceptance'],'INCONCLUSIVE')
        self.assertEqual(result['attempts'][0]['studyLog'],'NOT_OBSERVED')

    def test_actual_finality_native_identity_and_decision_projection(self):
        raw = {'schemaVersion':'asr-game-trace-export-v1','attempts':[{'attemptId':'a','nativeSessionId':'n','events':[
            {'type':'terminal-recognition-completed','attemptId':'a','nativeSessionId':'n','completionState':'terminal','evidenceFinality':'final','recognitionComplete':True,'transportComplete':True,'finalEvidenceReceived':True,'backendType':'android-native'},
            {'type':'final-ui-result-committed','attemptId':'b','decision':{'type':'PASS','pass':True,'transcript':'PRIVATE'}}]}]}
        attempt=kit.sanitize(raw)['attempts'][0]
        terminal=attempt['events'][0]
        self.assertEqual(terminal['completionState'],'terminal')
        self.assertEqual(terminal['evidenceFinality'],'final')
        self.assertTrue(terminal['recognitionComplete'])
        self.assertEqual(terminal['backendType'],'android-native')
        self.assertEqual(attempt['attemptIdHash'],terminal['attemptIdHash'])
        self.assertNotEqual(attempt['attemptIdHash'],attempt['events'][1]['attemptIdHash'])
        self.assertEqual(attempt['events'][1]['decision'],{'type':'PASS','pass':True})

    def test_rejects_unknown_export(self):
        with self.assertRaises(ValueError): kit.sanitize({'attempts':[]})

    def test_apk_rejects_tampered_archive(self):
        with tempfile.NamedTemporaryFile() as f:
            f.write(b'not an artifact');f.flush()
            with self.assertRaises(ValueError): kit.verify_apk(f.name)

    def test_apk_checks_exact_embedded_assets(self):
        authority = dict(kit.AUTHORITY)
        data = {}
        for relative in ['index.html','scripts/version.js','data/vocabulary-v3.json','data/items.json','data/characters.json']:
            data[relative] = subprocess.check_output(['git','show',authority['sourceSha']+':'+relative],cwd=kit.ROOT)
        def package(changed=False):
            apk = io.BytesIO()
            with zipfile.ZipFile(apk,'w') as z:
                for name,value in data.items(): z.writestr('assets/public/'+name,b'tampered' if changed and name=='data/items.json' else value)
            out = io.BytesIO()
            with zipfile.ZipFile(out,'w') as z:z.writestr('app-debug.apk',apk.getvalue())
            return out.getvalue()
        with tempfile.NamedTemporaryFile() as f:
            raw=package();f.write(raw);f.flush();authority['artifactZipSha256']=kit.digest(raw)
            self.assertEqual(kit.verify_apk(f.name,authority)['status'],'APK_VERIFIED')
        with tempfile.NamedTemporaryFile() as f:
            raw=package(True);f.write(raw);f.flush();authority['artifactZipSha256']=kit.digest(raw)
            with self.assertRaises(ValueError):kit.verify_apk(f.name,authority)

if __name__ == '__main__': unittest.main()
