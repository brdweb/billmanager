# AGENTS.md

Instructions for coding agents in this repository (Cursor cloud agents, Codex, Claude Code). The maintainer reviews and merges.

Personal or machine-specific notes never go in tracked files. Claude Code auto-loads the gitignored `CLAUDE.local.md`; Codex users put personal guidance in `~/.codex/AGENTS.md`; `AGENTS.local.md` is a gitignored scratch file that tools don't load automatically.

## Project

BillManager is a web, server, and Expo mobile monorepo. Web (`apps/web`, version in `package.json`) is React, TypeScript, Mantine, and Vite. Server (`apps/server`) is Flask, SQLAlchemy, and PostgreSQL 17. Mobile (`apps/mobile`, version in `package.json`) is an Expo development client, not Expo Go. CI uses Python 3.14 and Node.js 24.19.0. License: O'Saasy (`LICENSE`).

`.github/workflows/build.yml` does not publish an image or create a release. It runs on pushes to `main` and on pull requests targeting `main`.

Two release lanes are prepared by hand and then tagged by the maintainer. Agents never create tags or releases. Web and server ship together: a `chore(release)` pull request bumps the shared version (checklist at the top of `apps/web/src/config/releaseNotes.ts`) and adds `docs/release-notes/v<version>.md` plus the in-app notes. `.github/workflows/release-web.yml` runs on every `v*` tag push and on `workflow_dispatch`. Its publish job uses the `web-production` environment. Manual dispatch from any ref other than `main` or a `v*` tag fails. When the ref is a tag, the job also requires the name to be exactly `v` plus the `apps/web` version and the commit to be contained in `origin/main`. Before pushing an image, the job requires Backend Tests & Security, Frontend Tests & Security, Mobile Contract, Tests & SDK Compatibility, and Secrets Scan to be successful on the commit it checked out. `release-android.yml` and `release-ios.yml` run on every `mobile-v*` tag push and on `workflow_dispatch`. Manual dispatch from any ref other than `main` or a `mobile-v*` tag fails. When the ref is a tag, each workflow requires the name to be `mobile-v` plus the `apps/mobile` version, or that name plus `-build` and digits, and the commit to be contained in `origin/main`. The validate job in each mobile workflow runs `npm run check` for both tag pushes and manual dispatch.

## Commands

The shell blocks below are the `run` steps in `build.yml`. Backend pytest needs PostgreSQL 17 database `bills_test` and `DATABASE_URL` (CI: user `billsuser`).

**Backend Tests & Security** — lock checks and `pip-audit` from the repo root; install, pytest, and bandit in `apps/server`. Run pytest twice. The first uses `DEPLOYMENT_MODE=self-hosted`. The second uses `DEPLOYMENT_MODE=saas` and `--cov-append`.

```sh
python -m unittest discover -s scripts -p 'test_*lock*.py'
python scripts/check-python-lock.py
(cd apps/server && pip install -r requirements.lock)
(cd apps/server && DEPLOYMENT_MODE=self-hosted pytest -v --cov=. --cov-report=xml --cov-report=term-missing)
(cd apps/server && DEPLOYMENT_MODE=saas pytest -v --cov=. --cov-append --cov-report=xml --cov-report=term-missing)
(cd apps/server && bandit -r . -x tests -c bandit.yaml -f txt)
pip-audit -r apps/server/requirements.lock
```

**Frontend Tests & Security** — working directory `apps/web`:

```sh
npm ci
npm run test:coverage
npm run lint
npm run build
npm audit --audit-level=high
```

**Mobile Contract, Tests & SDK Compatibility** — working directory `apps/mobile`:

```sh
npm ci
npm run i18n:sync
git diff --exit-code -- src/i18n/locales
npm run api:check
npm run lint
npm run typecheck
npm test
npm run maestro:validate
npm run config:validate
npm run audit
```

In this `build.yml` job, `npx expo install --check` and `npm run doctor` run only when the scope step sets `expo_check=true`. On a push or pull request, that is when a changed path is under `apps/mobile/`, or when the comparison commit is missing, all zeros, or cannot be resolved, or the diff command fails. `build.yml` is not triggered by tags, so the script's tag branch does not run. `release-android.yml` and `release-ios.yml` run those Expo commands inside `npm run check` on `mobile-v*` tag pushes and on manual dispatch. `npm run check` (`apps/mobile/package.json`, described in `apps/mobile/README.md`) uses `i18n:check`, includes those Expo commands, and does not run `npm run audit`.

**Secrets Scan** checks out with `fetch-depth: 0` and runs `gitleaks/gitleaks-action@v3`. Config is `.gitleaks.toml`. That job has no `run` step.

**Validate Docker Image** runs only on `pull_request`, after Backend Tests & Security, Frontend Tests & Security, Mobile Contract, Tests & SDK Compatibility, and Secrets Scan succeed. `docker/build-push-action` builds the root `Dockerfile` for `linux/amd64` with `push: false`. That job has no `run` step.

**CodeQL** is the GitHub code scanning check (`Analyze (actions)`, `Analyze (javascript-typescript)`, `Analyze (python)`). No CodeQL workflow file is committed in this repository, and there is no local CodeQL command.

## Definition of done

The PR body uses `.github/PULL_REQUEST_TEMPLATE.md`: Summary, Verification, Scope.

- **Summary.** Start from a GitHub Issue with acceptance criteria. Say what changed and why, and link the Issue.
- **Verification.** The commands above pass locally. Paste that output. A UI change includes a screenshot. If a command could not be run, name it and why.
- **Scope.** State what was not done. Every bug fix adds a regression test that fails before the fix.

## Boundaries

- Never push to `main`. Never force-push a shared branch, delete branches or tags, or create tags or releases.
- No major dependency bumps. No edits to `.github/`, release config, auth, DB migrations, or secrets unless the Issue asks for that change.
- Auth, payments (`apps/server/services/stripe_service.py`), DB migrations (`apps/server/db_migrations.py`, `apps/server/migration.py`), Docker and Compose (`Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`), `.github/`, and release config are risky paths and need extra review.
- Never weaken or delete a test to make CI pass.
- Keep a pull request to about 400 changed lines. Split work that would exceed that.
- When a requirement is ambiguous, ask in the PR instead of guessing.

## Commits and PRs

Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `build(deps):`, `chore:`). The PR title uses the same form, because squash merges take the title as the commit subject. Never add `Co-Authored-By` or any other AI co-author or attribution trailer to a commit message or a PR body.

## Review guidance

Bugbot, Codex, and Claude should focus on the risky paths above, plus row-level tenant isolation, shared-bill payment direction, JWT and OAuth and passkeys, Stripe webhooks, OpenAPI and mobile contract drift, and keeping the public GHCR image free of SaaS analytics build arguments. The agent that opened the PR fixes review findings. The maintainer merges.

## Learning

Read [`docs/agent-mistakes.md`](docs/agent-mistakes.md) before starting. When a reviewer catches a repeatable mistake, add an entry to that file.
