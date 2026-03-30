#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
CONTAINER_NAME="${BACKEND_TEST_DB_CONTAINER:-billmanager-test-db}"
DB_USER="${BACKEND_TEST_DB_USER:-billsuser}"
DB_PASSWORD="${BACKEND_TEST_DB_PASSWORD:-billspass}"
DB_NAME="${BACKEND_TEST_DB_NAME:-bills_test}"
DB_PORT="${BACKEND_TEST_DB_PORT:-5432}"
DATABASE_URL="${DATABASE_URL:-postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}}"
DB_IMAGE="${BACKEND_TEST_DB_IMAGE:-postgres:16-alpine}"
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

run_tests() {
  if [[ ! -x "${VENV_DIR}/bin/pytest" ]]; then
    printf 'Missing virtualenv test dependencies. Run `make bootstrap` first.\n' >&2
    exit 1
  fi

  (
    cd "${ROOT_DIR}/apps/server"
    source "${VENV_DIR}/bin/activate"
    DATABASE_URL="${DATABASE_URL}" pytest tests -v -s --maxfail=1
  )
}

main() {
  require_cmd docker
  ensure_test_db

  if [[ "${DB_ONLY}" -eq 1 ]]; then
    printf 'Test database ready at %s\n' "${DATABASE_URL}"
    exit 0
  fi

  run_tests
}

main "$@"
