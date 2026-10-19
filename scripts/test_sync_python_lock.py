"""Which direct requirements a Dependabot lock sync may upgrade."""
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sync_python_lock', Path(__file__).with_name('sync-python-lock.py'))
assert spec is not None and spec.loader is not None
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class UpgradePackageTests(unittest.TestCase):
    def test_exact_pin_and_floor_bumps_only(self):
        base = 'flask==3.1.3\nsentry-sdk[flask]==2.71.0\nauthlib>=1.8.0\n'
        head = 'flask==3.1.3\nsentry-sdk[flask]==2.72.0\nauthlib>=1.9.1\n'
        self.assertEqual(sync.upgrade_packages(base, head), ['authlib', 'sentry-sdk'])

    def test_normalization_whitespace_and_comments_are_not_changes(self):
        base = '# header\n\nAPScheduler==3.11.3\npsycopg[binary]>=3.3.6\n'
        head = 'apscheduler == 3.11.3  # same pin\npsycopg[ binary ] >= 3.3.6\n'
        self.assertIsNone(sync.upgrade_packages(base, head))

    def test_extras_change_upgrades_that_package(self):
        self.assertEqual(
            sync.upgrade_packages('psycopg[binary]>=3\n', 'psycopg>=3\n'),
            ['psycopg'],
        )

    def test_added_package_is_upgraded_and_removal_is_not(self):
        base = 'flask==1\nstripe==16\n'
        head = 'flask==1\nresend==2\n'
        self.assertEqual(sync.upgrade_packages(base, head), ['resend'])

    def test_removal_still_counts_as_a_manifest_change(self):
        self.assertEqual(sync.upgrade_packages('flask==1\nstripe==16\n', 'flask==1\n'), [])

    def test_marker_change(self):
        self.assertEqual(
            sync.upgrade_packages('pyyaml>=6; python_version >= "3"', 'pyyaml>=6; python_version >= "3.14"'),
            ['pyyaml'],
        )

    def test_unsupported_and_duplicate_lines(self):
        for text in ['-r other.txt\n', 'flask @ https://example.com/flask.whl\n', 'flask==1\nflask==2\n']:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    sync.direct_requirements(text, 'requirements.txt')

    def test_cli_exit_codes(self):
        with self.subTest('unchanged'):
            self.assertEqual(self.cli('flask==1\n', 'flask==1\n'), (2, ''))
        with self.subTest('changed'):
            self.assertEqual(self.cli('flask==1\n', 'flask==2\n'), (0, 'flask\n'))
        with self.subTest('invalid'):
            status, _output = self.cli('-r other.txt\n', '-r other.txt\n')
            self.assertEqual(status, 1)

    def test_committed_manifest_round_trip(self):
        text = (ROOT / 'apps/server/requirements.txt').read_text(encoding='utf-8')
        self.assertIsNone(sync.upgrade_packages(text, text))
        self.assertIn('flask', sync.direct_requirements(text, 'requirements.txt'))

    def cli(self, base, head):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            base_path = Path(directory) / 'base.txt'
            head_path = Path(directory) / 'head.txt'
            base_path.write_text(base)
            head_path.write_text(head)
            stdout = io.StringIO()
            with patch('sys.argv', ['sync', '--base', str(base_path), '--head', str(head_path)]), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(io.StringIO()):
                status = sync.main()
            return status, stdout.getvalue()


class WorkflowContractTests(unittest.TestCase):
    def test_workflow_upgrades_only_named_packages_and_pushes_with_an_app_token(self):
        workflow = (ROOT / '.github/workflows/sync-python-lock.yml').read_text(encoding='utf-8')
        self.assertIn("github.event.pull_request.user.login == 'dependabot[bot]'", workflow)
        self.assertIn('contents: write', workflow)
        self.assertIn('--python-version 3.14', workflow)
        self.assertIn('--no-header', workflow)
        self.assertIn('--upgrade-package', workflow)
        self.assertNotRegex(workflow, r'--upgrade(?!-package)')
        self.assertNotIn('git push origin', workflow)
        self.assertIn('actions/create-github-app-token@v2', workflow)
        self.assertIn('PYTHON_LOCK_SYNC_APP_ID', workflow)
        self.assertIn('PYTHON_LOCK_SYNC_APP_PRIVATE_KEY', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertIn('chore(deps): sync requirements.lock for Dependabot', workflow)
        self.assertNotIn('pull-requests:', workflow)


if __name__ == '__main__':
    unittest.main()
