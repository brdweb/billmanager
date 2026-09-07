# Telemetry Documentation

BillManager includes an **optional** anonymous telemetry system to help improve the product by understanding how it's used in the wild.

## Privacy First

- **Completely optional** for self-hosted users (disabled via environment variable)
- **Never collects PII**: No usernames, emails, bill amounts, or personal data
- **Aggregated metrics only**: Total counts, averages, percentages
- **Transparent**: All collected data is documented below
- **Local logging**: All submissions are logged locally for your review

## What Gets Collected

### Instance Information
- **Instance ID**: Unique anonymous identifier (UUID)
- **Version**: BillManager version (e.g., "3.4.7")
- **Deployment Mode**: `saas`, `self-hosted`, or `local-dev`
- **Installation Date**: When first deployed

### Usage Metrics
- **Users**: Total count, admin vs regular, and users with a successful login in the prior 30 days
- **Data**: Total bills, payments, databases (bill groups)
- **Features**: Auto-pay usage, variable bills, mobile devices registered
- **Engagement**: Average bills per database

### Platform Information
- **Python Version**: e.g., "3.11.4"
- **Database**: Type and version (e.g., "PostgreSQL 15.2")
- **OS**: Operating system type (Linux, macOS, etc.)
- **Deployment Method**: Docker, bare metal, etc.

### SaaS-Only Metrics (when in SaaS mode)
- **Subscription Tiers**: Distribution of free/basic/plus users
- **Billing Intervals**: Monthly vs annual preference
- **Subscription Statuses**: Aggregate status distribution
- **Deployment Identification**: Configured server URL and public server IP, used only to alert the operator about a newly detected SaaS deployment

## Configuration

### Environment Variables

```bash
# Disable telemetry (self-hosted users only)
TELEMETRY_ENABLED=false

# Change telemetry endpoint (default: https://app.billmanager.app/api/telemetry)
TELEMETRY_URL=https://your-endpoint.com/telemetry

# Set deployment mode (auto-detected, but can override)
DEPLOYMENT_MODE=self-hosted  # or 'saas' or 'local-dev'

# Optional: Deployment method (helps with platform stats)
DEPLOYMENT_METHOD=docker  # or 'bare-metal', 'kubernetes', etc.

# Optional: Persist the anonymous ID at a custom mounted path
TELEMETRY_INSTANCE_ID_FILE=/data/.instance_id

# Optional: Supply a stable UUID directly (overrides the ID file)
TELEMETRY_INSTANCE_ID=550e8400-e29b-41d4-a716-446655440000

# Optional reliability tuning (defaults shown)
TELEMETRY_SEND_ATTEMPTS=3
TELEMETRY_RETRY_BASE_SECONDS=1
TELEMETRY_RETRY_MAX_SECONDS=30
TELEMETRY_MIN_SEND_INTERVAL_HOURS=20
TELEMETRY_LOCAL_LOG_RETENTION_DAYS=90
```

### For Self-Hosted Users

Add to your `.env` file or docker-compose.yml:

```yaml
environment:
  - TELEMETRY_ENABLED=false  # Disable telemetry
```

### For Telemetry Receiver Operators

The ingestion endpoint requires authentication by default, with payload
size, schema, and per-IP rate limits. The statistics endpoint requires
an instance-operator JWT or a separate `TELEMETRY_STATS_API_KEY`.
Ingestion credentials cannot read statistics. New-deployment alerts are emitted
only for submissions authenticated with an instance-operator JWT; sender-provided
deployment labels alone are not trusted operational events.

```bash
# Require the shared ingestion key (default)
TELEMETRY_INGEST_REQUIRE_AUTH=true
TELEMETRY_RECEIVER_API_KEY=change-this-to-a-long-random-string
TELEMETRY_STATS_API_KEY=change-this-to-a-different-long-random-string

# Set the same key on each explicitly provisioned sender
TELEMETRY_API_KEY=change-this-to-a-long-random-string

# Receiver safety and retention controls (defaults shown)
TELEMETRY_RATE_LIMIT_MAX_BUCKETS=10000
TELEMETRY_DEDUPE_MINUTES=10
TELEMETRY_SUBMISSION_RETENTION_DAYS=400
```

The built-in limiter is thread-safe and memory-bounded, but intentionally
process-local. For a receiver with multiple web workers, enforce the global
request limit at the existing Cloudflare or Traefik edge. This avoids adding a
Redis dependency while retaining the application limiter as defense in depth.

### Consent and Active-User Tracking

Telemetry consent is stored once per BillManager instance as `pending`,
`enabled`, or `disabled`. Pending consent fails closed and sends nothing. When
upgrading from the older per-owner setting, any existing owner opt-out wins;
otherwise a prior acceptance is preserved, and installations without a choice
remain pending.

Successful authentication updates a local `last_login_at` timestamp at most
once per rolling 24-hour period. Only the aggregate number of users active in
the prior 30 days is included in telemetry; individual login timestamps are
never sent.

## Telemetry Schedule

- **First send**: 5 minutes after startup
- **Recurring**: Daily at 2:00 AM UTC
- **Timeout**: 10 seconds per request
- **Retries**: Up to 3 attempts with bounded exponential backoff and jitter
- **Duplicate suppression**: Successful sends within the prior 20 hours are skipped
- **Worker coordination**: PostgreSQL advisory lock prevents overlapping scheduler sends

## Viewing Local Telemetry Logs

All telemetry submissions are logged to the `telemetry_log` table:

```sql
SELECT
  instance_id,
  version,
  deployment_mode,
  last_sent_at,
  send_successful,
  error_message
FROM telemetry_log
ORDER BY last_sent_at DESC;
```

To view the last metrics sent:

```sql
SELECT metrics_snapshot
FROM telemetry_log
ORDER BY last_sent_at DESC
LIMIT 1;
```

## Example Telemetry Payload

```json
{
  "instance_id": "550e8400-e29b-41d4-a716-446655440000",
  "version": "3.4.7",
  "deployment_mode": "self-hosted",
  "installation_date": "2024-01-15T10:30:00Z",
  "timestamp": "2024-02-01T02:00:00Z",

  "metrics": {
    "users": {
      "total": 5,
      "admins": 2,
      "regular": 3,
      "active_30d": 0,
      "account_owners": 1
    },
    "data": {
      "databases": 2,
      "bills": 127,
      "active_bills": 115,
      "archived_bills": 12,
      "payments": 89
    },
    "features": {
      "auto_pay_enabled": 45,
      "variable_bills": 12,
      "mobile_devices": 3,
      "deposits": 15,
      "expenses": 112,
      "auto_pay_percentage": 35.4,
      "variable_percentage": 9.4,
      "mobile_platforms": {
        "ios": 2,
        "android": 1
      }
    },
    "engagement": {
      "avg_bills_per_database": 63.5,
      "databases_with_bills": 2
    }
  },

  "platform": {
    "python_version": "3.11.4",
    "os": "Linux",
    "os_release": "6.1.0",
    "architecture": "x86_64",
    "database": "PostgreSQL 15.2",
    "deployment": "docker"
  }
}
```

## FAQ

### Q: Can I see what telemetry data was sent?
**A:** Yes! Check the `telemetry_log` table in your database. The `metrics_snapshot` column contains the full JSON payload.

### Q: What if telemetry sending fails?
**A:** Transient network errors, rate limits, and selected server errors are retried with backoff. One final result is logged locally, and the app continues running normally.

### Q: Does telemetry slow down the app?
**A:** No. Telemetry runs in a background thread and doesn't block app requests. Collection takes ~50ms, sending happens async.

### Q: Can I use my own telemetry endpoint?
**A:** Yes! Set `TELEMETRY_URL` to point to your own server.

### Q: How do I completely disable telemetry?
**A:** Set `TELEMETRY_ENABLED=false` in your environment variables.

### Q: What about GDPR/privacy regulations?
**A:** The telemetry system collects no PII and is fully transparent. Self-hosted users can disable it entirely. The data collected is similar to what GitHub Stars or Docker Hub pulls would reveal.

## Dashboard (Future)

Planned features for the telemetry dashboard on your production server:

- Total installations over time
- Version adoption rates
- Popular features
- Platform distribution (OS, database, deployment method)
- Geographic distribution (country-level only, via IP geolocation)
- Active installations (based on last ping)

## Reliability Without New Infrastructure

The sender, receiver, instance consent, active-user measurement, retries,
deduplication, retention, and scheduler coordination use only Python's standard
library, the existing APScheduler process, and BillManager's PostgreSQL
database.

For production abuse protection, add an edge rule limited to `POST
/api/telemetry` (for example, a modest per-IP burst/rate limit and a 16 KiB body
cap). Keep `/api/telemetry/stats` authenticated. Cloudflare or Traefik can do
this with the infrastructure already in the deployment path.

## Implementation Details

### Files
- `apps/server/services/telemetry.py` - Collection and sending logic
- `apps/server/services/scheduler.py` - Background task scheduler
- `apps/server/services/telemetry_receiver.py` - Receiver endpoint (production only)
- `apps/server/models.py` - `TelemetrySettings`, `TelemetryLog`, and `TelemetrySubmission` models

### Dependencies
- `APScheduler==3.11.3` - Background task scheduling
- `requests>=2.34.2` - HTTP client for sending telemetry

### Database Tables
- `telemetry_log` - Local submission tracking (all instances)
- `telemetry_settings` - Singleton instance-wide consent state
- `telemetry_submissions` - Received data (production server only)

## Contributing

If you have ideas for additional (privacy-safe) metrics that would help improve BillManager, please open an issue or PR!
