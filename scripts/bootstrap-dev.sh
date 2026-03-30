#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
DEFAULT_TARGETS=(backend web mobile)

usage() {
  cat <<'EOF'
Usage: ./scripts/bootstrap-dev.sh [backend] [web] [mobile]

Installs local development dependencies for the selected workspaces.
If no targets are provided, installs all of them.
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$cmd" >&2
    exit 1
  fi
}

init_node_env() {
  local fnm_bin="${HOME}/.local/share/fnm/fnm"

  if [[ -x "${fnm_bin}" ]]; then
    export PATH="${HOME}/.local/share/fnm:${PATH}"
    eval "$("${fnm_bin}" env --shell bash)"
  fi
}

setup_backend() {
  require_cmd python3
  require_cmd pip3

  if [[ ! -d "${VENV_DIR}" ]]; then
    python3 -m venv "${VENV_DIR}"
  fi

  # Install backend Python dependencies into the repo-local virtualenv.
  source "${VENV_DIR}/bin/activate"
  python -m pip install --upgrade pip
  pip install -r "${ROOT_DIR}/apps/server/requirements.txt"
}

setup_node_workspace() {
  local workspace="$1"

  init_node_env
  require_cmd npm
  require_cmd node

  (
    cd "${ROOT_DIR}/apps/${workspace}"
    npm ci
  )
}

main() {
  local targets=("$@")
  if [[ ${#targets[@]} -eq 0 ]]; then
    targets=("${DEFAULT_TARGETS[@]}")
  fi

  for target in "${targets[@]}"; do
    case "$target" in
      backend)
        setup_backend
        ;;
      web)
        setup_node_workspace web
        ;;
      mobile)
        setup_node_workspace mobile
        ;;
      -h|--help|help)
        usage
        exit 0
        ;;
      *)
        printf 'Unknown bootstrap target: %s\n' "$target" >&2
        usage >&2
        exit 1
        ;;
    esac
  done
}

main "$@"
