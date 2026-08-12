# Mobile implementation status and release gates

Status snapshot: 2026-07-15, `codex/mobile-native-rewrite`.

This document tracks implementation evidence, not a release declaration. A row marked **Implemented** means the source path exists and is wired into the application. It does not mean that the flow has passed the complete iOS, Android, SaaS, self-hosted, accessibility, or store acceptance matrix.

## Status legend

| Status | Meaning |
|---|---|
| **Implemented** | The shared or platform-adaptive flow is wired to live data and has code-level coverage. Device and release validation may still be open. |
| **Partial** | A usable implementation exists, but at least one required parity behavior is still missing or is only represented by a shell. |
| **Native validation** | Native source and JavaScript integration exist, but a clean native build and real-device ceremony are still required. |
| **Not started** | No release-ready implementation or acceptance evidence exists. |
| **Online only** | This intentionally requires a current server response and is disabled or read-only offline. |
| **Out of scope** | Explicitly excluded from the 1.0 replacement release. |

## Feature parity by role and deployment

`Member` includes a regular user with access to one or more bill groups. `Owner/admin` includes account-owner-only actions where the server distinguishes them. `SaaS` and `self-hosted` describe deployment behavior, not separate mobile binaries.

| Capability | Member | Owner/admin | SaaS | Self-hosted | Current state and remaining proof |
|---|---|---|---|---|---|
| Server selection and capability negotiation | Available | Available | Cloud profile | HTTPS profile | **Implemented.** Profiles isolate URL, credentials, selected database, cache, outbox, and capabilities. Minimum-version handling has unit coverage. Test compatible and incompatible live servers on both platforms. |
| Login and logout | Available | Available | Available | Available | **Implemented.** Profile-scoped tokens and `/me` adoption are wired. Complete device flows against both deployment modes remain required. |
| Registration and email verification/resend | Capability-gated | Capability-gated | Server-configured | Server-configured | **Implemented.** Screens and API calls are capability-gated. Validate registration-disabled, verification-required, expired-token, and German-language paths. |
| Forgot/reset password and forced password change | Available | Available | Available | Available | **Implemented.** Deep-link routes and API calls exist. Validate email links, expired tokens, and first-login self-hosted administrator behavior. |
| Team and bill-share invitation links | Available | Available | Capability-gated | Capability-gated | **Implemented.** Acceptance routes exist. Complete authenticated and anonymous deep-link testing; invitation changes are not remotely pushed. |
| OAuth/OIDC login and account linking | Capability-gated | Capability-gated | Provider-configured | Provider-configured | **Implemented; native validation pending.** Hosted Android Google sign-in uses Credential Manager with nonce-bound server verification; Microsoft and the remaining provider/platform combinations use the system browser. Validate real-device cancellation, account linking, and 2FA continuation before store submission. |
| Email OTP, recovery codes, disablement | Available | Available | Capability-gated | Capability-gated | **Implemented.** Management and challenge screens are wired. Complete security-device and recovery acceptance tests. |
| Passkey registration, login, and management | Available | Available | Capability-gated | Capability-gated | **Native validation.** AuthenticationServices and Android Credential Manager modules exist. Associated-domain/asset-link configuration and real-device ceremonies must pass before release. |
| Biometric application lock | Available | Available | Local | Local | **Implemented; native validation pending.** App lock is a UI gate and permits local reminders/background work. Test enrollment changes, fallback, background timeout, and lock-screen privacy. |
| Home monthly pulse, upcoming bills, totals, activity | Available | Available | Available | Available | **Implemented.** Uses cached live bills/payments and All Buckets metadata. Complete large-data, empty, stale, and cross-bucket device tests. |
| Bill create/edit and expense/deposit fields | Available | Available | Available | Available | **Implemented.** Optimistic SQLite writes and outbox mutations cover create/update. Validate every server recurrence pattern, variable amount, reminders, auto-pay, icon, category, account, and notes. |
| Bill discovery, archive/restore/delete | Available | Available | Available | Available | **Implemented.** Active/archived views support search, type, inclusive due-date, account, and category filters; six explicit sort orders; FlashList-backed incremental paging; offline archive/restore; move-between-buckets; and database-ID-first All Buckets attribution. Permanent delete correctly requires a connection. Complete high-volume and live cross-bucket device validation. |
| Payment record/edit/delete and advance due | Available | Available | Available | Available | **Implemented.** Offline create/edit/delete and dependency-aware outbox paths exist. Validate temporary bill/payment ID reconciliation, retry idempotency, duplicate prevention, and due-date advancement on live servers. |
| Global payment history, totals, filters, paging | Available | Available | Available | Available | **Implemented.** Cached history supports preset/custom date ranges, type/account/category/bucket and amount filters, explicit sorting, FlashList paging, All Buckets labels, and reset. Received/shared-derived records are protected from unsupported edit/delete actions. Device and high-volume performance validation remains. |
| CSV, PDF, print, and native share | Available | Available | Available | Available | **Native validation.** Export code uses filesystem-backed CSV plus Expo Print and Sharing. Validate filenames, locale/currency, share targets, printing, and temporary-file cleanup. |
| Reminder inbox and local notification actions | Available | Available | Local | Local | **Implemented; native validation pending.** Open, Snooze, and Mark Paid are wired. Validate denied permission, offline Mark Paid, timezone/DST changes, and a full 60-day reschedule. |
| Calendar day agenda | Available | Available | Available | Available | **Implemented.** Live 1-, 3-, and 6-month grids, day agenda, bucket totals, bill creation, bill detail/edit routing, and direct Mark Paid actions are wired. Range-specific total verification plus device performance and accessibility proof remain open. |
| Analytics and cash-flow views | Available | Available | Available | Available | **Implemented.** Annual and year-over-year summaries, category/account breakdowns, 6/12-month series, yearly history, recurring-bill forecast semantics, and a real year picker are wired to cached live data. Comparison values and breakdown details render directly instead of placeholder alerts. Server parity plus chart accessibility and visual/device validation remain open. |
| Bill sharing management | Capability-gated | Capability-gated | Capability-gated | Capability-gated | **Implemented, online only for changes.** Incoming/outgoing invitations, accepted shares, split management bridge, and revoke actions exist. Profile/database-scoped collaboration snapshots provide durable offline reads after a successful sync; mutations still require a fresh server response. |
| Settlements | Capability-gated | Capability-gated | Capability-gated | Capability-gated | **Implemented, online only for changes.** Settlement summaries, per-person detail, history, and mark-paid actions exist. Profile/database-scoped snapshots provide durable offline reads after a successful sync; settlement mutations still require a fresh server response. |
| User, invitation, and bill-group administration | No access | Role-gated | Available | Available | **Implemented, online only.** Role-aware containers and legacy create/edit forms are wired. Validate owner-versus-admin permissions, cross-tenant denial, destructive actions, and German copy. |
| Plans, usage, trials, checkout, and portal | No access unless owner/admin | Role-gated | Available | Unlimited/local state | **Implemented, online only.** SaaS actions and self-hosted unlimited behavior are modeled. Complete Stripe test-mode, return-link, expired-trial, and self-host visibility tests. |
| English/German, deployment currency/locale | Available | Available | Config-driven | Config-driven | **Implemented.** Mobile catalogs are generated from web catalogs; UI language is English/German and currency uses deployment `Intl` settings. Run a complete untranslated-string and layout-expansion audit. |
| Light/dark/system, telemetry, release notes | Available | Available | Available | Available | **Implemented.** Settings routes are wired. Complete device persistence, opt-in telemetry, and release-note version tests. |
| Phone/tablet adaptive layout | Available | Available | Available | Available | **Implemented at layout level.** Android uses Material-adaptive presentation and a navigation rail at wide sizes; iOS uses Apple-oriented presentation. Representative phone/tablet and rotation acceptance tests are still required. |
| iOS and Android home-screen widgets | Available | Available | Local | Local | **Native validation.** WidgetKit/Expo Widgets and Jetpack Glance sources exist, deep-link to the app, and hide amounts by default. Clean builds, installation, refresh, privacy, and deep-link tests remain. |
| Remote push, OCR, attachments, Live Activities | Not available | Not available | Not available | Not available | **Out of scope.** The replacement client does not register for remote push. |

## Offline and synchronization coverage

| Behavior | Current state | Release work remaining |
|---|---|---|
| Durable local store | **Implemented.** SQLCipher-enabled Expo SQLite schema stores profiles, groups, bills, payments, reminders, analytics snapshots, sync state, outbox, and conflicts. | Prove encryption in release binaries, migration under interruption, corruption recovery, backup exclusion, and cache limits. |
| Profile/database isolation | **Implemented.** Every repository key includes server profile and database. Credentials are profile-scoped in SecureStore; legacy 32-bit profile IDs migrate to SHA-256 identities across credentials and SQLite state. Authentication, refresh, logout, profile activation, foreground sync, widget writes, and database selection use immutable scopes or latest-started generation guards. | Repeat the automated race matrix on installed iOS and Android builds, including process death and native storage latency. |
| Offline reads | Bills, payments, Home, Calendar, locally derived analytics, sharing, and settlements are **implemented**. Collaboration and settlement snapshots are durably scoped to profile/database after a successful online read. | Validate cold offline launch, stale-state labeling, cache limits, and snapshot behavior across profile/database switches on devices. |
| Offline mutations | Bill create/update/archive/restore and payment create/update/delete/mark-paid are **implemented** through the outbox. | Verify dependency ID remapping, retries across process death, all recurrence payloads, and duplicate-payment protection. |
| Idempotency and conflicts | `client_mutation_id`, exact server-version tokens, 409 mapping, a conflict queue, and use-server/keep-local choices are **implemented**. Retries remain replayable after bill moves and deletes; malformed, future, duplicate-in-batch, cross-database, and cross-user mutations fail closed. Keep-local recreates a server-deleted edited bill from its complete encrypted cache payload, while an already-missing object satisfies a matching local delete intent. Sequential edits and repeated offline Mark Paid/payment actions chain the server version of the affected bill or payment instead of creating self-inflicted stale conflicts. | Run device conflict tests for modified, deleted, and permission-changed objects and verify recovery across process death and reconnect. |
| Synchronization triggers | Login/session start, foreground, reconnect, profile/database switch, successful mutation, and opportunistic background task are wired automatically. Pull-to-refresh and **Retry now** provide manual retries; only true object conflicts require a user choice. | Measure platform throttling and interrupted-sync recovery; background work must never be presented as a precise scheduler. |

## Mandatory release gates

The public replacement must not ship until every gate below is checked. The current state is intentionally conservative.

| Gate | Current state | Evidence required to close |
|---|---|---|
| Active web parity matrix is 100% complete | **Open** | Freeze the active web baseline, attach one mobile equivalent and test identifier to every capability, and close any role/deployment/device gaps found by that acceptance matrix. |
| Lint, typecheck, unit, contract, component, and device suites pass in CI | **Source-level CI gates implemented; release gate open** | The local combined mobile check passes 171 tests across 48 files, validates 6 Maestro flows, reports Expo Doctor 20/20, and confirms generated-contract and dependency drift are clean; the complete server suite passes 167 tests. CI enforces the same source checks. Execute the Maestro role/deployment/device matrix on installed binaries before closing this gate. |
| `expo install --check` and Expo Doctor pass | **Local checks passed and CI definitions enforce both; release gate open** | Record both commands from a clean release-candidate install and a green branch CI run. |
| Clean Android development and release builds | **Local debug build passed; release gate open** | CNG prebuild, the passkey and Glance modules, application Kotlin compilation, and `assembleDebug` pass locally. Install the dev client, validate notification actions/passkeys/widgets/deep links on representative devices, and produce a signed release candidate. |
| Clean iOS development and release builds | **Open; requires Mac** | CNG prebuild, CocoaPods/Xcode compile, simulator and physical device flows, AuthenticationServices, WidgetKit, universal links, signing, archive, and App Store validation. |
| Role/deployment/bucket acceptance matrix passes | **Open** | Member, administrator, and owner; SaaS and self-hosted; one bucket and All Buckets; English/German; light/dark/system; phone/tablet; online/offline/reconnect/conflict. |
| Accessibility acceptance passes | **Open** | VoiceOver, TalkBack, dynamic type/font scale, reduced motion, chart summaries, focus order, tablet keyboard, contrast, and 44-point/48-dp touch targets. |
| Performance and resilience thresholds pass | **Open** | Large bill/payment lists, 6-month calendar, charts, cold/warm startup, memory pressure, migration, background task, cache limits, and interrupted synchronization. |
| No open P0/P1 or protected data-integrity defect | **Source-level audit closed; release gate open** | Adversarial repository audits and regression tests close the discovered credential, profile, widget, idempotency, and stale-conflict races. Repeat the defect triage against signed release candidates and the full device/role/deployment matrix before public release. |
| Alpha remains compatible with additive server changes | **Partially evidenced** | Server contract tests cover mobile idempotency/conflict behavior; run an installed alpha regression suite against the release candidate server. |
| Production HTTP is rejected with actionable copy | **Implemented; validation open** | CI configuration validation proves that preview and production native configuration are HTTPS-only while development profiles alone opt into cleartext. Still run a release-profile device test against an HTTP self-hosted URL on both platforms. |
| Store readiness is complete | **Not started** | Signing, privacy manifests/disclosures, account deletion, permission copy, screenshots, metadata, review credentials, TestFlight, and Play closed testing. |
| Reminder/HTTPS documentation matches product behavior | **Implemented in repository docs** | Review this documentation against the signed release candidate and public support documentation. |
| Widget data is minimal and amounts are hidden by default | **Implemented; validation open** | Inspect iOS shared container and Android preferences plus lock-screen/home-screen behavior in release builds. |
| Release binary contains no development URL, cleartext exception, test credential, or debug telemetry | **Open** | Inspect the final Android App Bundle and iOS archive produced with the production EAS profile. |
| Simultaneous public App Store and Google Play replacement | **Not authorized** | Both closed-test tracks pass the same matrix and a release owner explicitly approves publication. |

## Deferred features

Remote push, receipt OCR, attachments, and Live Activities are not parity blockers for 1.0 because they are explicitly outside this release. Budget UI remains outside the baseline unless it becomes active on the web before contract freeze.
