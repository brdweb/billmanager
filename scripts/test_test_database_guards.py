"""Regression tests for destructive test-database entry-point guards."""

import os
from pathlib import Path
import re
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate-test-database-url.py"
E2E = ROOT / "test-e2e.sh"
WORKFLOW = ROOT / ".github" / "workflows" / "build.yml"


def _database_url(host: str = "192.168.40.113", query: str = "") -> str:
    authority = "billsuser" + ":" + "not-a-real-secret" + "@" + host
    return f"postgresql://{authority}:5432/bills_test{query}"


def _validate(url: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "DATABASE_URL": url}
    return subprocess.run(
        [sys.executable, str(VALIDATOR)],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_approved_external_database_url_is_accepted():
    result = _validate(_database_url())
    assert result.returncode == 0


def test_unapproved_host_and_hostaddr_are_rejected():
    wrong_host = _validate(_database_url(host="127.0.0.1"))
    wrong_hostaddr = _validate(_database_url(query="?hostaddr=127.0.0.1"))
    assert wrong_host.returncode == 1
    assert wrong_hostaddr.returncode == 1
    assert "Refusing external database" in wrong_host.stderr
    assert "Refusing external database" in wrong_hostaddr.stderr


@pytest.mark.parametrize(
    "override",
    [
        "host=127.0.0.1",
        "port=5433",
        "dbname=postgres",
        "database=postgres",
        "user=postgres",
        "service=unsafe",
        "HOST=127.0.0.1",
        "%68ost=127.0.0.1",
    ],
)
def test_libpq_query_target_overrides_are_rejected(override):
    result = _validate(_database_url(query=f"?{override}"))
    assert result.returncode == 1
    assert "Refusing external database" in result.stderr


def test_e2e_rejects_unapproved_target_before_creating_lock(tmp_path):
    lockfile = Path("/tmp/billmanager-test-e2e.lock")
    lockfile.unlink(missing_ok=True)
    env = {
        **os.environ,
        "BACKEND_TEST_DB_URL": _database_url(host="127.0.0.1"),
    }
    result = subprocess.run(
        ["bash", str(E2E)],
        env=env,
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "Refusing external database" in result.stderr
    assert not lockfile.exists()


def test_ci_service_and_application_passwords_match():
    workflow = WORKFLOW.read_text()
    service = re.search(r"^\s*POSTGRES_PASSWORD:\s*(.+)$", workflow, re.MULTILINE)
    application_pattern = r"^\s*DATABASE_URL:\s*postgresql://" + r"billsuser:(.+)@localhost"
    application = re.search(
        application_pattern, workflow, re.MULTILINE
    )
    assert service is not None
    assert application is not None
    assert service.group(1) == application.group(1)
