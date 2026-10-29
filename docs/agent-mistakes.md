# Agent mistakes

Repeatable mistakes reviewers catch in this repository. Read this file before starting work. Add an entry when a reviewer catches a mistake that should not be repeated. The log is empty.

## Entry format

- **Date:** YYYY-MM-DD
- **PR:** link to the pull request
- **Mistake:** what went wrong
- **Rule going forward:** what to do instead

- **Date:** 2026-10-29
- **PR:** https://github.com/brdweb/billmanager/pull/245
- **Mistake:** Persisted requested subscription labels even when configured price IDs alias a different canonical interval.
- **Rule going forward:** Resolve the selected Stripe price through the canonical price-to-plan mapping before persisting billing state, and test aliased price configuration.
