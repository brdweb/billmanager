# Agent mistakes

Repeatable mistakes reviewers catch in this repository. Read this file before starting work. Add an entry when a reviewer catches a mistake that should not be repeated. The log is empty.

## Entry format

- **Date:** YYYY-MM-DD
- **PR:** link to the pull request
- **Mistake:** what went wrong
- **Rule going forward:** what to do instead

- **Date:** 2026-10-29
- **PR:** https://github.com/brdweb/billmanager/pull/243
- **Mistake:** Used stored-profile credential validity as a screen-action freshness check. Inactive profiles retain valid credentials for background work, so an old screen callback could still mutate that profile or open its checkout after a switch.
- **Rule going forward:** UI actions need a mounted scope lease and an active profile/principal/group check before dispatch and after asynchronous work. Keep stored-auth checks for authorization, and test profile switches with the old credentials still valid, including unmounts and native alert callbacks.
