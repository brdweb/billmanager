# Security Policy

BillManager handles personal financial data, so security reports are welcome and appreciated.

## Supported Versions

Security fixes are provided for the latest release and the current `main` branch. If you run the Docker image, keep your deployment updated to the newest tagged release or `ghcr.io/brdweb/billmanager:latest`.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository when available. If private reporting is not available, open a public issue asking for a private contact method, but do not include exploit details, secrets, personal data, database dumps, or live instance URLs.

Helpful reports include:

- Affected version, commit, or Docker image tag
- Clear reproduction steps
- Expected and actual behavior
- Impact and affected component, such as authentication, authorization, data isolation, billing data, mobile API tokens, email flows, or telemetry
- Any logs or screenshots with secrets and personal data removed

I will acknowledge valid reports as soon as practical and coordinate fixes privately before public disclosure.

## Operator Guidance

For production deployments:

- Set strong unique values for `FLASK_SECRET_KEY`, `JWT_SECRET_KEY`, database credentials, OAuth secrets, SMTP credentials, and API keys.
- Serve BillManager only over HTTPS.
- Restrict database access to the application and trusted maintenance hosts.
- Keep PostgreSQL, Docker images, and host packages patched.
- Back up the database and test restores before upgrades.
- Disable optional features you do not use, such as telemetry, OAuth providers, 2FA/passkeys, or email providers.

Before submitting security-sensitive changes, run:

```bash
make verify
```

The CI pipeline also runs backend tests, Bandit, pip-audit, frontend tests, npm audit, and gitleaks secret scanning.
