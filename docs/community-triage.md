# Community triage playbook

> **DRAFT — awaiting board approval before publication.**

## Cadence and ownership

Review new issues and pull requests twice weekly. Aim to acknowledge a
complete, non-security report within five business days. This is an
expectation, not a service-level agreement.

Before discussing a report, search open and closed issues and pull requests.
Every triage entry must name an owner and one next action: reproduce, request
specific missing information, link and close as duplicate, schedule, or close
with a factual reason. Reports missing version, environment, or steps are
labelled `waiting-for-reporter` after one specific request. Suspected security
reports are not triaged publicly; direct them to the private route in
`SECURITY.md` without confirming or reproducing the report.

## Proposed labels

These are drafts for a repository administrator to create after board
approval; this branch does not create labels on GitHub.

| Label | Meaning | Triage action |
| --- | --- | --- |
| `needs-triage` | New report not yet assessed | Assign a triage owner. |
| `waiting-for-reporter` | Required reproduction detail was requested | Await one of version, environment, or steps. |
| `duplicate` | Existing report already tracks the same problem | Link the canonical report and close. |
| `good first issue` | Small, isolated task with explicit completion check | Keep its scope and definition of done in the issue. |

## Proposed good-first-issue cards

These are issue drafts only; none has been created or labelled publicly. A
technical owner must confirm the affected file and test command before opening
one.

1. **Add a `CONTRIBUTING.md` link to the README developer workflow.**
   - Owner: Wrench (technical confirmation), then a contributor.
   - Scope: one Markdown link in `README.md`.
   - Done: the link resolves to `CONTRIBUTING.md`; no behavior changes.
2. **Add a sentence to `apps/mobile/README.md` linking to the shared contribution guide.**
   - Owner: Pocket (mobile-status confirmation), then a contributor.
   - Scope: one Markdown link only; it must not state or imply a public mobile release.
   - Done: link resolves and mobile availability language is unchanged.

If either card needs more than the stated file or test, remove the label rather
than expanding its scope.
