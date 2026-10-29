# BillManager market launch plan

Prepared October 29, 2026. The target is a working hosted web application and updated signed Android and iOS applications submitted to their stores, followed by public availability after each store's required review and testing. The initial iOS storefront remains United States only. Existing Free and Pro pricing stays at USD 2.99 monthly or USD 24 annually.

## Current baseline

The product checkout is synchronized to `530680f`, whose main CI and CodeQL runs passed. Web/server is version 4.13.2 and mobile is 1.1.1 on Expo SDK 58. Marketing, documentation, and the internal dashboard are separate repositories. Their default branches were fetched and verified clean before work.

Historical October store evidence records Android closed testing and a failed iOS upload, with incomplete privacy, review-access, screenshot, device, and diagnostics evidence. These records are not current store acceptance. Live dashboard verification is required. Existing GitHub release environments require reviewer approval; preserve those protections.

## Implementation ownership and sequence

All application code is assigned to GPT-6.1 Sol sub-agents. The coordinating agent owns this plan, review, integration, provider access, release evidence, and store submission. Use isolated branches, issue acceptance criteria, focused pull requests, passing CI and resolved review threads. Do not create release tags; use the existing manual release workflows after approved changes reach main.

| Phase | Owner | Work | Completion evidence |
| --- | --- | --- | --- |
| 1. Establish baseline | Coordinator and all agents | Synchronize repositories; restore exact locked dependencies with supported runtimes; inventory signing, stores, production and available test devices | Current revisions, repeatable commands, authenticated access status, failing checks separated from source defects |
| 2. Mobile account isolation | Mobile agent | Bind persistent cache, queued mutations and network queries to authenticated account and server. Prevent old-account jobs or late requests from executing/rendering in a new account. Preserve same-account offline work safely | Regressions for two accounts on one server, shared group IDs, server switch, logout/relogin, pending queues and late responses; full mobile checks |
| 3. Web identity and group recovery | Web/server agent | Return account ownership consistently across authentication methods; make web permissions agree. Reject stale bill requests after account/group changes. Recover from a removed stored group without a login loop | Managed-admin/owner auth regressions, stale-response test, revoked-group recovery test; backend in both deployment modes; web lint/tests/build |
| 4. Mobile transaction feedback | Mobile agent | Report failed/partial settlement updates, avoid duplicate checkout taps, and handle failed external URL opens | Regression coverage for failed response, partial response, duplicate tap and link rejection |
| 5. Store purchase behavior | Mobile agent and coordinator | Audit every native purchase link. Until Google enrollment and required integration are verified, make Play build consumption-only with no checkout/upsell links. Preserve existing subscription access. Retain iOS external checkout only for the confirmed US-only release | Platform-policy tests, UI inspection, review notes and verified store territories; no unverified enrollment assumptions |
| 6. Public launch surfaces | Public-sites agent | Reconcile the already-reviewed account-deletion page and diagnostics disclosures into current marketing source; preserve newer accurate policy wording. Give missing static routes real 404 responses. Add relevant deletion/help links and correct availability statements. Fix demonstrated dependency blockers within existing major versions | Clean site builds, actual page-content and missing-route checks, usable help/privacy/deletion navigation; dashboard exact-lock tests |
| 7. Release preparation | Agents and coordinator | Assign a fresh mobile native version/runtime boundary (candidate 1.2.0) for changed native dependencies; prepare web/server patch release notes (candidate 4.13.3). Update only confirmed release facts | Matching package/lock/config/version contracts, changelog, clean CI and reviewed PRs |
| 8. Hosted deployment | Coordinator | Verify current service revision, production configuration and recoverable backup; build/publish from the reviewed revision through the existing workflow. Update only BillManager-owned services with rollback digests recorded | Live version/health, anonymous auth boundary, signup/login, bills/payment flow, subscription readiness and legal/help content; rollback record |
| 9. Signed mobile candidates | Coordinator | Dispatch Android and iOS production builds from the reviewed revision; use remote signing/build numbers. Inspect build logs, artifacts, permissions, transport restrictions and runtime version | Successful signed AAB and IPA, source revision and build IDs, Android 16 KB compatibility, required iOS export/signing validation |
| 10. Installed acceptance | Coordinator and owner when hardware is needed | Exercise real Android and iOS candidates: onboarding/password/OAuth/2FA, roles, groups, bill/payment CRUD, offline cold start, sync retry/conflicts, logout/account switch, reminders, widgets, accessibility and account deletion using disposable test accounts | Dated platform/device/build evidence, screenshots from real app execution, diagnostics receipt/privacy/symbolication; no source-only substitution |
| 11. Store submission | Coordinator | Upload exact candidates, complete truthful privacy and Data safety, support/deletion URLs, review access, screenshots, age/content/export declarations and release notes. Submit iOS for review and update the appropriate Play testing release; apply for production only when eligible | Store processing and submission status with build/version identity; reviewer rejection handled explicitly |
| 12. Public release and observation | Coordinator | Publish only after platform approval, acceptance and Play production eligibility. Verify public listings/installability and production behavior; update website/docs availability after verification | Public links, install checks and observed service health; support and rollback instructions |

## Decisions and scope

Prioritize confirmed correctness and release blockers over redesign or speculative features. Remote push, receipt OCR, attachments and Live Activities remain outside this launch. The internal operator dashboard needs validation and demonstrated fixes only. Do not change prices, charge real customers in testing, erase production data, accept new legal terms on the owner's behalf, disable approval gates, or claim native acceptance from unit tests.

The unused billing change-plan endpoint appears to promise deferred changes while applying them immediately. Investigate reachability and add an explicit correction or disable unsupported behavior in a separate reviewed change; avoid expanding subscription scope unnecessarily.

## Validation strategy

- Install from lockfiles and use Node 24.19.0/Python 3.14 as the repository specifies. Use isolated PostgreSQL test storage on a free port, never production data.
- Run backend tests in both self-hosted and SaaS modes, lock checks, Bandit and dependency audit. Run web coverage, lint, production build and focused browser flows.
- Run mobile `npm run check` and `npm run audit`; inspect generated API/translation drift and clean native configuration. Run authenticated device flows in addition to the existing entry-screen Maestro definitions.
- Run marketing build and content/route checks, documentation typecheck/build, and dashboard backend/frontend tests, lint and build. Review only actionable audit findings; never use blind major upgrades or suppress failing tests.
- For every release, record the commit, build artifact, store build number, submission result and unresolved gate. Uploaded, processed, submitted, approved and public are distinct states.

## External dependencies and critical path

GitHub reviewer approval may be needed when the protected release job reaches its gate. Apple/Google sign-in or 2FA, owner declarations, real reviewer credentials and an iPhone may need owner participation. Prepare the concrete candidate and forms before asking for decisions. Do not expose keys, passwords, session data or review credentials in chat or tracked files.

Google's current personal-account policy requires 12 testers opted in continuously for at least 14 days before applying for production access. The live account's current eligibility still needs verification. This elapsed-time requirement cannot be replaced with simulated users or automated tests. [Google testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)

Apple currently permits external purchase links in US-storefront apps; confirm US-only availability and the final candidate's behavior. Google external purchase links require program enrollment and integration, so the launch plan uses consumption-only Android behavior until those are verified. [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google external content links](https://support.google.com/googleplay/android-developer/answer/16470497?hl=en)

Implementation and store-access checks run in parallel. Signed builds follow integration and CI; store submission follows candidate processing and required acceptance. Public availability depends on platform review and Play eligibility, not a promised calendar date.

## Progress record

- October 29: initial audits completed; confirmed account-isolation, web identity/race, deletion-route and release-metadata work scoped. Main CI at the synchronized baseline is green. Live store inspection and implementation are in progress.
