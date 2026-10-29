# Agent mistakes

Repeatable mistakes reviewers catch in this repository. Read this file before starting work. Add an entry when a reviewer catches a mistake that should not be repeated. The log is empty.

## Entry format

- **Date:** YYYY-MM-DD
- **PR:** link to the pull request
- **Mistake:** what went wrong
- **Rule going forward:** what to do instead

- **Date:** 2026-10-29
- **PR:** https://github.com/brdweb/billmanager/issues/236
- **Mistake:** Treating the last authenticated session as proof of ownership for older mobile cache and queued-change rows. An earlier account's rows can survive a later account's sign-in.
- **Rule going forward:** Migrate financial/offline work only with trustworthy per-row ownership. Otherwise preserve it in an unreachable encrypted quarantine, explain recovery, and never replay it with the current account's credentials. Treat owner and access/refresh credentials as one atomic envelope during token/profile migrations.
