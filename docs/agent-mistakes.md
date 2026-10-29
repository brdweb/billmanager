# Agent mistakes

Repeatable mistakes reviewers catch in this repository. Read this file before starting work. Add an entry when a reviewer catches a mistake that should not be repeated.

## Entry format

- **Date:** YYYY-MM-DD
- **PR:** link to the pull request
- **Mistake:** what went wrong
- **Rule going forward:** what to do instead

- **Date:** 2026-10-29
- **PR:** https://github.com/brdweb/billmanager/pull/243
- **Mistake:** Used stored-profile credential validity as a screen-action freshness check. Inactive profiles retain valid credentials for background work, so an old screen callback could still mutate that profile or open its checkout after a switch.
- **Rule going forward:** UI actions need a mounted scope lease and an active profile/principal/group check before dispatch and after asynchronous work. Keep stored-auth checks for authorization, and test profile switches with the old credentials still valid, including unmounts and native alert callbacks.

- **Date:** 2026-10-29
- **PR:** https://github.com/brdweb/billmanager/pull/245
- **Mistake:** Persisted requested subscription labels even when configured price IDs alias a different canonical interval.
- **Rule going forward:** Resolve the selected Stripe price through the canonical price-to-plan mapping before persisting billing state, and test aliased price configuration.

- **Date:** 2026-10-29
- **PR:** https://github.com/brdweb/billmanager/issues/236
- **Mistake:** Treating the last authenticated session as proof of ownership for older mobile cache and queued-change rows. An earlier account's rows can survive a later account's sign-in.
- **Rule going forward:** Migrate financial/offline work only with trustworthy per-row ownership. Otherwise preserve it in an unreachable encrypted quarantine, explain recovery, and never replay it with the current account's credentials. Treat owner and access/refresh credentials as one atomic envelope during token/profile migrations. A cached user snapshot also cannot establish ownership of an unbound legacy token: only live authentication/identity verification may establish it.

- **Date:** 2026-10-29
- **PR:** https://github.com/brdweb/billmanager/issues/236
- **Mistake:** Wired a Mark paid intent to a legacy toggle without binding the action to the share version and bill occurrence. Another client or recurrence can change the intended state.
- **Rule going forward:** Send immutable version/occurrence preconditions with idempotency identity, verify server capability, and check them atomically under consistent row locks before any guarded state change.

- **Date:** 2026-10-29
- **PR:** https://github.com/brdweb/billmanager/pull/243
- **Mistake:** Used a person's net balance to decide whether outgoing shares could be paid, and permanently suppressed successful occurrences without reconciling a later server reopen.
- **Rule going forward:** Derive payable actions from the directional unpaid ledger. Retain mutation IDs across uncertain failures, and retire them only after causally fresh server state; a late pre-mutation read or cached refetch is not payment-state evidence. Test mixed-direction balances, partial failure, paid/reopened occurrences and delayed reads.

### 2026-10-29 — Verify foreign-key locks when adding payment row locks (#236)

A bill `FOR UPDATE` followed by a share lock can deadlock with an existing share-first action inserting a bill-referencing audit row. Use a scoped `FOR NO KEY UPDATE` bill lock when only non-key bill fields must remain stable; it blocks renewal edits while allowing foreign-key `KEY SHARE` checks. Reproduce the exact competing route schedule with real PostgreSQL, including its audit insert, rather than only testing two instances of the new route.
