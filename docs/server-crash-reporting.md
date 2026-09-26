# Server crash reporting

The Flask server reports unhandled request exceptions and explicit
`sentry_sdk.capture_exception()` calls when `SENTRY_DSN` is configured. A blank
or missing DSN disables initialization in both SaaS and self-hosted mode. There
is no built-in BillManager DSN. This is independent of usage telemetry consent.
Handled API errors and background jobs are not automatically captured; logging
integration is deliberately disabled. No endpoint or response schema changes.

## Configuration

Use a Sentry **free-tier** project. Set runtime environment variables using the
deployment's private configuration, never source control:

- `SENTRY_DSN`: the server project's DSN. No auth/upload token is needed.
- `SENTRY_ENVIRONMENT`: `staging`, `production`, or another deployment label;
  defaults to `development`. Never use account names or customer identifiers.
- `SENTRY_RELEASE`: an immutable build label, default `server-v<APP_VERSION>`.
  Set this explicitly if the deployment does not inject its actual version.

The main Compose file forwards these variables. Other deployment systems must
inject them into the server process. An invalid DSN fails startup with a generic
error that does not repeat its value. Remove `SENTRY_DSN` and restart to disable.
No paid features, purchases, or quota increases are required or authorized. The
SDK respects Sentry rate limits; project quota exhaustion can drop errors.

## Outbound data contract

The SDK uses only its Flask integration. Outbound events retain random event
IDs, event timestamps, configured release/environment labels, Python runtime
version, exception class names, and stack frames (deployed relative code file,
function, line number, and whether it belongs to the app). Exception values are
replaced with a fixed string. This intentionally reduces debugging context.

Request URLs, query strings, headers, cookies, bodies, users/IP fields, tenant
IDs, tags, extras, breadcrumbs, source context, frame locals, absolute host
paths and arbitrary SDK contexts are excluded. Trace propagation, tracing,
profiling, logs, metrics, automatic sessions and client reports are disabled.
The transport strips envelope trace metadata and all non-error items, including
attachments and manually created sessions. This server configuration has no
release-health/session stream; mobile release health is a separate configuration.
The Sentry endpoint still necessarily observes the server's network source IP.
Account retention, region and server-side processing must be checked in the
actual Sentry project; this document does not establish legal policy coverage.

`tests/test_crash_reporting.py` exercises the pinned SDK and Flask integration,
replaces only the HTTP transport sink, and checks serialized envelopes with
synthetic financial/authentication canaries. Repeat this contract verification
on every SDK upgrade. Local envelope checks do not prove Sentry received them.

## Non-production receipt verification

After project access and deployment approval are available, use a disposable
server environment with its **non-production** DSN and release label. Do not
point a test at a production database. Run from `apps/server` with the installed
server dependencies. This isolated Flask probe never imports the BillManager
app or opens a database, and adds no production route:

```python
import os
import sentry_sdk
from flask import Flask
from services.crash_reporting import init_crash_reporting

assert os.environ.get("SENTRY_ENVIRONMENT") in {"test", "staging"}
assert os.environ.get("SENTRY_DSN")
init_crash_reporting("sentry-smoke")
probe = Flask(__name__)
probe.logger.disabled = True

@probe.get("/sentry-smoke")
def crash():
    sentry_sdk.set_extra("bill", "SYNTHETIC_PRIVATE_PAYEE_94713")
    raise RuntimeError("SYNTHETIC_PRIVATE_PAYEE_94713")

assert probe.test_client().get("/sentry-smoke").status_code == 500
sentry_sdk.flush(timeout=10)
print("Probe complete; verify receipt in Sentry (flush is not receipt evidence).")
```

Inspect the **raw captured event in Sentry**, not only its issue title. Record
the event link/ID, timestamp, project, environment, release and useful stack
frames without copying the DSN. Confirm the synthetic marker, request data,
locals, attachments and identifiers listed above are absent. Confirm the free
plan, retention/region and received categories with the project administrator.
The deployed server's configuration and a captured error from that deployment
must also be verified after authorized rollout; this probe alone does not prove
production is live. Supply the actual findings to the store privacy audit and
policy owner before claiming the overall crash-reporting task complete.

## Rollback

Unset `SENTRY_DSN` and restart, or revert the integration commit and reinstall the
previous lock. No database schema changes or migrations; existing rows are
unchanged. Removing the SDK does not remove previously received Sentry events;
use the project's retention/deletion controls for those.
