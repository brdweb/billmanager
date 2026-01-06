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
- **Users**: Total count, admin vs regular, active users (30 days)
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
- **Trial Conversions**: Aggregate conversion rates

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
```

### For Self-Hosted Users

Add to your `.env` file or docker-compose.yml:

```yaml
environment:
  - TELEMETRY_ENABLED=false  # Disable telemetry
```

## Telemetry Schedule

- **First send**: 5 minutes after startup
- **Recurring**: Daily at 2:00 AM UTC
- **Timeout**: 10 seconds per request
- **Retries**: None (failures logged locally, will retry next cycle)

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
      "active_30d": 4,
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
**A:** Failures are logged locally with error messages. The app continues running normally. Next send attempt occurs at the scheduled time.

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

## Implementation Details

### Files
- `services/telemetry.py` - Collection and sending logic
- `services/scheduler.py` - Background task scheduler
- `services/telemetry_receiver.py` - Receiver endpoint (production only)
- `models.py` - `TelemetryLog` and `TelemetrySubmission` models

### Dependencies
- `APScheduler==3.10.4` - Background task scheduling
- `requests==2.31.0` - HTTP client for sending telemetry

### Database Tables
- `telemetry_log` - Local submission tracking (all instances)
- `telemetry_submissions` - Received data (production server only)

## Contributing

If you have ideas for additional (privacy-safe) metrics that would help improve BillManager, please open an issue or PR!
