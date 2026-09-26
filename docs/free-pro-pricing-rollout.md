# Free / Pro rollout (BIL-39)

## Entitlement transitions

- New SaaS account with billing enabled: 30-day local no-card trial with Pro limits.
- Trial expires without payment: Free limits. Existing trial end dates remain unchanged.
- Trial/Free -> paid: checkout uses only configured Pro prices; verified Stripe events grant Pro.
- Active stored Basic/Plus or historical Basic/Plus price: Pro limits; retain legacy IDs for webhook resolution.
- Active Pro monthly <-> annual: existing plan-change implementation remains unchanged; webhook reconciles the interval. Its claimed period-end scheduling is not validated here (it calls Stripe modify with no proration, not a subscription schedule); do not use that endpoint for the internal cutover.
- Past due, unpaid, canceled: retain existing Free fallback; scheduled cancellation remains active until Stripe ends it.
- Self-hosted: no billing or enforced tier limits.
- Duplicate/out-of-order webhook protection is unchanged.

## Deployment coordination — Big Cheese

Before enabling checkout, set STRIPE_PRICE_PRO_MONTHLY and STRIPE_PRICE_PRO_ANNUAL to the new USD 299/month and 2400/year prices. Both must be created with tax_behavior=exclusive. Missing either keeps billing readiness false (503); there is no fallback to a historical price.
Keep STRIPE_PRICE_BASIC_MONTHLY, STRIPE_PRICE_BASIC_ANNUAL, STRIPE_PRICE_PLUS_MONTHLY and STRIPE_PRICE_PLUS_ANNUAL until all historical subscription/webhook references are retired. They resolve entitlements only and cannot be purchased. Archive old Stripe prices; never delete them.

Live Stripe creation, price archival and the internal subscription replacement require separate confirmation immediately before execution. No live Stripe mutation is part of this code change. Big Cheese owns deployment configuration and review; Pocket reviews the mobile contract and release timing. Existing mobile builds still carry old display copy; legacy checkout tier inputs remain accepted as Pro aliases. Public config retains legacy pricing/limit response keys as non-purchasable Pro aliases and adds purchasable_tiers=["pro"]. Effective tier adds the Pro value; Pocket must ship the updated label handling with this release.

## Data and rollback

No schema or bulk data migration. Existing rows keep tier labels, trial dates and Stripe IDs; Basic/Plus labels map to Pro at read time. New verified paid events store Pro. A code rollback after Pro sales must retain Pro entitlement/price recognition (or map those rows and prices explicitly); simply reverting would remove access for Pro rows. Do not automatically reverse charges or rewrite trial dates. Never deploy or change live billing as a side effect of merging.
