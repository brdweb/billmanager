# Runtime and deployment behavior

This document defines the support boundary for self-hosted transport security, offline synchronization, local reminders, and widgets. Store/support copy must not promise behavior beyond this boundary.

## Application updates

New preview and production binaries disable Expo Updates and run only the code
and assets embedded in the installed binary. Fixes arrive through a new
TestFlight, Google Play, App Store, or explicitly installed preview binary;
there is no production OTA hotfix/download/rollback path at launch. Development
clients retain their development update configuration and Metro workflow.

This removes the release app's automatic Expo Update requests, whose client ID,
update metadata and previous fatal-error header are independent of Sentry's
payload filtering. It does not change already-installed older binaries and does
not establish wire-level privacy proof. Validate the final candidate's embedded
Android/iOS flags and actual startup/crash/relaunch traffic before closing that
release gate. Expo build services and the remaining approved runtime services
retain their separate boundaries.

## Production server transport

Production mobile connections require:

1. an `https://` BillManager URL;
2. a certificate chain trusted by the operating system for this application;
3. a reachable health/config endpoint;
4. a compatible mobile contract version.

The URL is normalized to `/api/v2`, then the profile is verified before login. A compatible server returns the capability envelope used to show or hide registration, OAuth, email OTP, passkeys, billing, administration, sharing, and settlements. An incompatible minimum mobile version opens the upgrade-required screen instead of a generic network error.

Release builds reject cleartext HTTP in both the profile validator and native transport configuration. The user-facing error should explain that HTTPS with a certificate trusted by the device is required.

## Development HTTP

Development builds may connect to a local HTTP server. This exception exists only for emulator/device development and is controlled by `BILLMANAGER_DEVELOPMENT_BUILD=true`.

Never use a development or preview binary to certify production transport behavior. The release gate must exercise a `production`-profile binary and confirm that an HTTP URL is rejected.

## Private certificate authorities

A private CA is supported only when the certificate chain is trusted by the operating system for the application. BillManager does not ship an in-app CA store, certificate importer, trust bypass, or certificate-pinning exception.

Operational guidance:

- iOS/iPadOS: install the CA through the device-management/profile workflow and enable the trust required by the operating system.
- Android: use an organization/device configuration that makes the CA trusted for the application. Android versions and OEM policies differ in how user-installed CAs are exposed to applications.
- include the complete intermediate chain on the BillManager reverse proxy;
- make the certificate hostname match the exact server hostname entered in the app;
- validate the intended iOS and Android device classes before declaring the deployment supported.

Merely importing a CA file is not release evidence. Android private-CA behavior in particular remains a device acceptance item until the signed release candidate succeeds without weakening the production trust configuration.

## Server profiles and data isolation

Each server profile has its own:

- normalized base URL and capabilities;
- access and refresh credentials;
- selected database/bill group;
- SQLCipher cache rows;
- synchronization state and cursor;
- outbox mutations and conflicts.

Switching profiles closes the current session before activating the other isolated workspace. Requests always use the active profile client and explicit `X-Database` value.

## Offline reads and writes

Current durable offline reads cover bills, payments, Home, Calendar, locally derived analytics, sharing, and settlements. Sharing and settlement data is stored in profile/database-scoped snapshots after a successful online read. Sharing and settlement changes intentionally require a current server response.

The offline outbox supports:

- bill create and update;
- bill archive and restore;
- payment create, edit, and delete;
- Mark Paid with optional due-date advancement.

Mutations are sequential within one server profile/database and may run independently for different profiles. A payment created for a locally created bill records a dependency on the bill creation mutation.

Each mutation carries a UUID `client_mutation_id`. Updates and deletes carry the object's `base_updated_at`. The server deduplicates retries for the authenticated user/database/mutation tuple and returns HTTP 409 for a stale base.

Routine transfers and retries are automatic and do not require a decision. When the same object changed locally and on the server, the conflict is never silently overwritten. The **Sync & offline data** screen offers:

- **Use server version**: discard the pending local change and restore the returned server object;
- **Keep my changes**: rebase and retry the local mutation against the server update timestamp.

Security, OAuth, sharing changes, settlements, administration, and SaaS billing remain online-only and require a fresh server response.

### Safe shared-bill payment recording

Mark Paid from Settlements requires the server's
`settlement_payment_preconditions` feature plus each row's `share_updated_at`,
`bill_updated_at` and due date. Earlier servers remain readable, but the app asks for a server
update and refresh rather than sending an unguarded toggle.

Each payment intent sends its original `client_mutation_id`, `base_updated_at`,
`base_bill_updated_at` and `expected_due_date` together. An uncertain retry keeps
all four values;
it never silently substitutes a newer version into an old intent. A definite
409 conflict blocks that intent until a real, causally fresh server read lets
the user review the current amount/date and explicitly try again. A reopened
or renewed occurrence receives a new intent only after current server state
has been observed. Cached data and late pre-mutation reads cannot reset retries.

## Synchronization timing

BillManager requests synchronization automatically at session start, when the app returns to the foreground, after reconnecting, after a profile/database switch, and after mutations. Pull-to-refresh and **Retry now** on the **Sync & offline data** screen provide manual retries. The platform background task provides an opportunistic refresh.

Background work is not a precise scheduler. iOS and Android may delay or skip it because of battery state, usage history, system policy, or force-quit behavior. Product and support copy must not promise immediate cross-device updates.

## Local reminders, not remote push

The replacement client schedules notifications locally from synchronized bill data. It does not register a remote push token.

After a successful synchronization, the app rebuilds a rolling 60-day reminder window. Scheduling is also attempted after foreground/reconnect/mutation flows and opportunistic background refresh. Reminders support:

- **Open**: deep-link to the bill;
- **Snooze**: schedule another local reminder 24 hours later;
- **Mark Paid**: open/authenticate as required and record or enqueue a payment.

If notification permission is denied, the in-app reminder inbox remains available. Amounts are omitted from notification copy unless a future explicit privacy setting enables them.

Important limitations:

- invitation/share changes and edits made on another device are discovered by email and the next successful synchronization;
- there is no guarantee of an immediate notification for a remote change;
- force-quitting the app or restrictive battery settings can delay background refresh;
- timezone, daylight-saving, locale, and reminder-window behavior must be revalidated on every release candidate.

## Widgets

The iOS WidgetKit/Expo Widget and Android Jetpack Glance widget receive a minimal local snapshot:

- next bill identifier and title;
- due label;
- next amount and remaining-month label only when `showAmounts` is explicitly enabled.

The runtime currently writes snapshots with `showAmounts: false`, so amounts are hidden by default. Widgets deep-link to Home or a bill. They do not perform independent server authentication or precise background synchronization.

Widget source exists, but installation, app-group/preferences storage, refresh, privacy redaction, deep linking, theme, and lock-screen/home-screen behavior remain native release-validation items.

## Account isolation and earlier offline changes

Each authenticated account now has its own encrypted local cache, pending-change
queue, reminders and synchronization state within a server profile. Signing out
preserves that account's qualified offline work; signing in as another account
cannot display or send it. Returning to the original account resumes its work.

Earlier app versions did not record a reliable owner for each local row. On
upgrade, all earlier financial cache and queued changes are retained in encrypted
quarantine. The last signed-in user is not evidence of ownership, so those rows
are never automatically assigned or replayed. Reconnect and refresh to download
the current account's bills. An earlier token with no verified owner cannot
restore a cached user while offline; reconnect and sign in or complete a live
identity check first. Already-qualified matching accounts retain offline access.
A persistent recovery notice remains if earlier
unsynced changes exist, even after the current account synchronizes successfully.

For recovery, keep the app installed and do not clear its data. Contact your
server administrator or BillManager support to verify the account that created
the earlier changes and plan an owner-verified recovery. Automatic recovery and
export of this quarantine are not implemented in this release. Do not describe
quarantined changes as synchronized or assume reinstalling will preserve them.
