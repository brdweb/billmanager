SHELL := /bin/bash
.SHELLFLAGS := -lc

PYTHON ?= python3
VENV ?= .venv
COMPOSE_FILE ?= docker-compose.dev.yml
BACKEND_TEST_DB_CONTAINER ?= billmanager-test-db
BACKEND_TEST_DB_URL ?= postgresql://billsuser:billspass@localhost:5432/bills_test
PIP_AUDIT_TIMEOUT ?= 120

.PHONY: help bootstrap install install-backend install-web install-mobile \
	dev-up dev-down dev-logs dev-ps \
	test verify test-backend test-web test-mobile \
	security-checks bandit pip-audit test-db-up test-db-down

help:
	@printf "Available targets:\n"
	@printf "  make bootstrap        Install local Python and Node dependencies\n"
	@printf "  make dev-up           Build and start the local Docker stack\n"
	@printf "  make dev-down         Stop the local Docker stack\n"
	@printf "  make dev-logs         Follow Docker stack logs\n"
	@printf "  make dev-ps           Show Docker stack status\n"
	@printf "  make test             Run backend, web, and mobile tests\n"
	@printf "  make verify           Run tests plus security checks\n"
	@printf "  make security-checks  Run bandit and pip-audit\n"
	@printf "  make test-db-up       Start the local backend test database\n"
	@printf "  make test-db-down     Remove the local backend test database\n"

bootstrap: install

install: install-backend install-web install-mobile

install-backend:
	@./scripts/bootstrap-dev.sh backend

install-web:
	@./scripts/bootstrap-dev.sh web

install-mobile:
	@./scripts/bootstrap-dev.sh mobile

dev-up:
	docker compose -f $(COMPOSE_FILE) up -d --build

dev-down:
	docker compose -f $(COMPOSE_FILE) down

dev-logs:
	docker compose -f $(COMPOSE_FILE) logs -f

dev-ps:
	docker compose -f $(COMPOSE_FILE) ps

test: test-backend test-web test-mobile

verify: test security-checks

test-backend:
	@DATABASE_URL="$(BACKEND_TEST_DB_URL)" ./scripts/test-backend.sh

test-web:
	cd apps/web && npm test

test-mobile:
	cd apps/mobile && npm test

security-checks: bandit pip-audit

bandit:
	cd apps/server && ../../$(VENV)/bin/bandit -r . -x tests -c bandit.yaml -f txt

pip-audit:
	timeout $(PIP_AUDIT_TIMEOUT) bash -lc 'source $(VENV)/bin/activate && pip-audit -r apps/server/requirements.txt'

test-db-up:
	@./scripts/test-backend.sh --db-only

test-db-down:
	@docker rm -f $(BACKEND_TEST_DB_CONTAINER) >/dev/null 2>&1 || true
