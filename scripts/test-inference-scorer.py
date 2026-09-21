"""Positive and fault controls for the benchmark's strict output scorer."""
import json
from pathlib import Path
import runpy
import unittest
import hashlib
import tempfile

module = runpy.run_path(str(Path(__file__).with_name('benchmark-local-inference.py')))
summary = runpy.run_path(str(Path(__file__).with_name('summarize-inference.py')))


class ScorerTests(unittest.TestCase):
    def test_expected_outputs(self):
        for case in module['CASES']:
            expected = case['expected']
            output = json.dumps(expected) if isinstance(expected, dict) else expected
            self.assertTrue(module['correct'](case, output))

    def test_wrong_outputs_fail(self):
        for case in module['CASES']:
            self.assertFalse(module['correct'](case, 'incorrect'))

    def test_markdown_is_not_json(self):
        case = module['CASES'][3]
        self.assertFalse(module['correct'](case, '```json\n' + json.dumps(case['expected']) + '\n```'))

    def test_valid_json_wrong_claim_fails(self):
        self.assertFalse(module['correct'](module['CASES'][3],
            '{"sample":true,"action":"click_save","result":"saved"}'))

    def test_inventory_detects_tampering_and_unlisted_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'log.txt').write_bytes(b'original')
            (root / 'inventory.json').write_text(json.dumps({
                'log.txt': hashlib.sha256(b'original').hexdigest()}), encoding='utf-8')
            self.assertEqual(summary['verify'](root)['verified_files'], 1)
            (root / 'log.txt').write_bytes(b'altered')
            with self.assertRaises(ValueError):
                summary['verify'](root)
            (root / 'log.txt').write_bytes(b'original')
            (root / 'extra.txt').write_bytes(b'unlisted')
            with self.assertRaises(ValueError):
                summary['verify'](root)


if __name__ == '__main__':
    unittest.main()
