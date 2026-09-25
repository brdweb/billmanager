"""Unit regressions for lock validation; no network or environment mutation."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('check_lock', Path(__file__).with_name('check-python-lock.py'))
assert spec is not None and spec.loader is not None
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class LockTests(unittest.TestCase):
    def check(self, locked, resolved=None, failure=False):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / 'lock.txt'
            lock.write_text(locked)
            def resolve(command, **kwargs):
                self.assertIn('--constraint', command)
                self.assertNotIn('--upgrade', command)
                self.assertEqual(command[command.index('--constraint') + 1], str(lock))
                if failure:
                    raise subprocess.CalledProcessError(1, command)
                assert resolved is not None
                Path(command[command.index('--output-file') + 1]).write_text(resolved)
            with patch('sys.argv', ['check', '--lock', str(lock)]), patch.object(checker.subprocess, 'run', side_effect=resolve), contextlib.redirect_stdout(io.StringIO()):
                return checker.main()

    def test_valid_pins_ignore_annotation_and_order(self):
        self.assertEqual(self.check('B_pkg==2\n # via a\na==1\n', 'a==1\nb-pkg==2\n'), 0)

    def test_missing_pin(self):
        self.assertEqual(self.check('a==1\n', 'a==1\nb==2\n'), 1)

    def test_extra_pin(self):
        self.assertEqual(self.check('a==1\nb==2\n', 'a==1\n'), 1)

    def test_changed_version(self):
        self.assertEqual(self.check('a==1\n', 'a==2\n'), 1)

    def test_incompatible_manifest(self):
        self.assertEqual(self.check('a==1\n', failure=True), 1)

    def test_nonexact_and_duplicate_pins(self):
        for text in ['a>=1\n', 'a==1\na==1\n', '-r other.txt\n', 'a==1; python_version > "3"\n']:
            with self.subTest(text=text):
                self.assertEqual(self.check(text), 1)


if __name__ == '__main__':
    unittest.main()
