# Contributing to BillManager

> **DRAFT — awaiting board approval before publication.**

Thank you for considering a contribution. This guide covers the commands that
were exercised in the project maintainer container on 2026-09-26.

## First ten minutes

Clone your fork, then enter the checkout:

```sh
git clone https://github.com/<your-account>/billmanager.git
cd billmanager
```

This project uses Python 3.14 in CI and Node.js 24.19.0 for the web app. The
following web and Python-lock commands were run from this checkout:

```sh
(cd apps/web && npm ci)
(cd apps/web && npm test)
(cd apps/web && npm run build)
.venv/bin/python scripts/check-python-lock.py
```

The backend suite was also run here against the project's approved test
database, using configuration that is intentionally not published in this
guide. Do not point a test run at a production database. The standard backend
test path uses Docker to create its test database; it was not exercised here.

The commands above are verification commands, not a promise that this
container can run every development workflow: it has no Docker daemon, root or
sudo access, device builds, or mobile store pipeline. Mobile test and type
checks may be available, but no native build or device test was performed here.

## Before opening an issue

Search open and closed issues first. For a bug report, include the release or
commit, environment, short reproduction steps, expected behavior, and actual
behavior. If any of those are missing, maintainers will ask once for the
specific missing information and mark the report as waiting.

Do not put suspected vulnerabilities in a public issue. Use the private
reporting route in [SECURITY.md](SECURITY.md).

## Pull requests

Keep each pull request focused. State what changed, how you tested it, and any
follow-up that is intentionally out of scope. Do not include generated output
unless the source change requires it. A maintainer will triage each pull
request with an owner and next action.

## Licence

BillManager is distributed under the [O'Saasy License](LICENSE). The licence
states: "No licensee or downstream recipient may use the Software (including
any modified or derivative versions) to directly compete with the original
Licensor by offering it to third parties as a hosted, managed, or
Software-as-a-Service (SaaS) product or cloud service where the primary value
of the service is the functionality of the Software itself."
