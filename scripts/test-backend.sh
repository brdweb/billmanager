#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
CONTAINER_NAME="${BACKEND_TEST_DB_CONTAINER:-billmanager-test-db}"
DB_USER="${BACKEND_TEST_DB_USER:-billsuser}"
DB_PASSWORD="${BACKEND_TEST_DB_PASSWORD:-billspass}"
DB_NAME="${BACKEND_TEST_DB_NAME:-bills_test}"
DB_PORT="${BACKEND_TEST_DB_PORT:-5432}"
BACKEND_TEST_DB_EXTERNAL="${BACKEND_TEST_DB_EXTERNAL:-0}"
if [[ "${BACKEND_TEST_DB_EXTERNAL}" == "1" ]]; then
  DATABASE_URL="${BACKEND_TEST_DB_URL:?BACKEND_TEST_DB_URL is required when BACKEND_TEST_DB_EXTERNAL=1}"
else
  DATABASE_URL="${BACKEND_TEST_DB_URL:-postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}}"
fi
DB_IMAGE="${BACKEND_TEST_DB_IMAGE:-postgres:17-alpine}"
DB_ONLY=0

if [[ "${1:-}" == "--db-only" ]]; then
  DB_ONLY=1
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$cmd" >&2
    exit 1
  fi
}

ensure_test_db() {
  local status
  status="$(docker inspect -f '{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || true)"

  if [[ -z "${status}" ]]; then
    docker run -d \
      --name "${CONTAINER_NAME}" \
      -e POSTGRES_USER="${DB_USER}" \
      -e POSTGRES_PASSWORD="${DB_PASSWORD}" \
      -e POSTGRES_DB="${DB_NAME}" \
      -p "${DB_PORT}:5432" \
      "${DB_IMAGE}" >/dev/null
  elif [[ "${status}" != "running" ]]; then
    docker start "${CONTAINER_NAME}" >/dev/null
  fi

  for _ in $(seq 1 30); do
    if docker exec "${CONTAINER_NAME}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  printf 'Timed out waiting for %s to accept connections\n' "${CONTAINER_NAME}" >&2
  exit 1
}

validate_external_test_db() {
  if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
    printf 'Missing virtualenv test dependencies. Run `make bootstrap` first.\n' >&2
    exit 1
  fi

  DATABASE_URL="${DATABASE_URL}" "${VENV_DIR}/bin/python" - <<'PY'
import os

import psycopg
from psycopg.conninfo import conninfo_to_dict

url = os.environ["DATABASE_URL"]
try:
    info = conninfo_to_dict(url)
except psycopg.Error:
    raise SystemExit("External test database configuration is invalid") from None
approved_identity = {
    "host": "192.168.40.113",
    "port": "5432",
    "dbname": "bills_test",
    "user": "billsuser",
}
if any(info.get(key, "") != value for key, value in approved_identity.items()):
    raise SystemExit("Refusing external database: target is not the approved test database")
if info.get("hostaddr", "") not in ("", approved_identity["host"]):
    raise SystemExit("Refusing external database: target is not the approved test database")

try:
    with psycopg.connect(
        host=approved_identity["host"],
        hostaddr=approved_identity["host"],
        port=approved_identity["port"],
        dbname=approved_identity["dbname"],
        user=approved_identity["user"],
        password=info.get("password", ""),
        connect_timeout=5,
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            if cursor.fetchone() != (1,):
                raise SystemExit("External test database validation failed")
except psycopg.Error:
    raise SystemExit("External test database connection failed") from None
PY
  printf 'External test database identity and connectivity validated\n'
}

run_tests() {
  if [[ ! -x "${VENV_DIR}/bin/pytest" ]]; then
    printf 'Missing virtualenv test dependencies. Run `make bootstrap` first.\n' >&2
    exit 1
  fi

  local modes="${BACKEND_TEST_MODES:-${DEPLOYMENT_MODE:-self-hosted saas}}"
  local mode

  for mode in ${modes}; do
    case "${mode}" in
      self-hosted|saas) ;;
      *)
        printf 'Unsupported backend test deployment mode: %s\n' "${mode}" >&2
        exit 1
        ;;
    esac

    printf 'Running backend tests in %s mode\n' "${mode}"
    (
      cd "${ROOT_DIR}/apps/server"
      source "${VENV_DIR}/bin/activate"
      DATABASE_URL="${DATABASE_URL}" DEPLOYMENT_MODE="${mode}" pytest tests -v -s --maxfail=1
    )
  done
}

main() {
  case "${BACKEND_TEST_DB_EXTERNAL}" in
    0)
      require_cmd docker
      ensure_test_db
      ;;
    1)
      validate_external_test_db
      ;;
    *)
      printf 'BACKEND_TEST_DB_EXTERNAL must be 0 or 1\n' >&2
      exit 1
      ;;
  esac

  if [[ "${DB_ONLY}" -eq 1 ]]; then
    printf 'Test database is ready\n'
    exit 0
  fi

  run_tests
}

main "$@"
