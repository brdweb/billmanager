# Stripe billing readiness and webhook recovery

SaaS billing is advertised as enabled only when the Stripe SDK, API key, webhook secret, and all four configured prices (Basic/Plus, monthly/annual) are present. The public `/api/v2/config` response includes only generic readiness state; operator logs use a fixed warning without configuration-derived values. Self-hosted deployments keep billing disabled even if Stripe variables happen to be present.

A SaaS checkout request returns `503` while readiness is incomplete. Correct the operator configuration and restart the server. Trial provisioning retains the existing SaaS/API-key policy independently of payment readiness. A missing webhook secret/configuration also returns `503`. Invalid signatures or malformed payloads return `400`. Both are failed deliveries; do not assume Stripe stops retries solely because a response is `400`.

Webhook event IDs are stored in a durable unique ledger. Retries and concurrent duplicates are acknowledged without applying business effects twice. Subscription-bearing events are serialized per subscription; checkout completions additionally serialize per user. Older deliveries do not overwrite newer state. Standalone invoice events are deliberately acknowledged without subscription changes. Processing or commit failures roll back the ledger and local changes and return `500`, so Stripe can retry.

## Recovery

1. Check the sanitized readiness payload from `/api/v2/config` and the fixed incomplete-configuration warning in server logs. Privately verify the configuration components listed above; do not print credentials.
2. Correct the relevant environment variables, including every offered price and the endpoint signing secret, then restart the application.
3. Confirm readiness and monitor the Stripe Dashboard's webhook delivery status.
4. For a processing failure, inspect application logs and database state, correct the underlying issue, and use Stripe Dashboard's manual **Resend** for the affected event.

There is no automatic production replay. Operators must review the event and use Stripe's controlled resend after recovery. Every supported verified event must contain an event ID and creation timestamp. Distinct events created in the same second reconcile against the current Stripe subscription under the transaction lock; failed retrieval or an unknown price leaves the event retryable rather than guessing its order.

## Upgrade and operational boundaries

Migration `20260907_01` adds `stripe_webhook_events` and the subscription ordering timestamp through the existing startup migration mechanism. The ledger contains event identifiers and timestamps, not webhook payloads. It covers deliveries handled after this upgrade, not historical events previously acknowledged by older code. No automatic ledger pruning is performed.

A webhook referencing a subscription not yet present locally returns `500` so a later checkout delivery can establish the association first. If the account was permanently deleted, no user is recreated; operators must distinguish deletion from delayed delivery before resending.

A checkout for a different Stripe subscription cannot silently overwrite an existing local subscription association, even after cancellation. This conflict returns `500` and requires operator reconciliation of the old/new Stripe subscriptions and local association before resend. Automatic subscription replacement, refunding duplicate purchases, and production data repair are outside this change. Monitor failed deliveries so these conflicts do not go unnoticed.

Presence checks cannot prove that secrets/prices belong to the intended Stripe account, that Stripe can reach the endpoint, or that the configured Stripe API version matches the event payload. Validate those boundaries with a Stripe test-mode end-to-end delivery before production promotion. No live Stripe event was replayed as part of local verification.
