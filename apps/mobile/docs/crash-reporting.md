# Mobile crash reporting

The mobile app can send crash and error reports to a Sentry project. It is
opt-in at build time: without a DSN the Sentry client is never created and the
app makes no Sentry network requests. This page is the developer reference;
dated rollout evidence and release gates live in
[implementation-status.md](implementation-status.md) and
[development-builds.md](development-builds.md#sentry-setup-and-release-evidence).
For the server equivalent see [../../../docs/server-crash-reporting.md](../../../docs/server-crash-reporting.md).

## How it is wired

| Piece | File | Role |
| --- | --- | --- |
| Startup | `index.ts` | Calls `initializeSentry()` before `registerRootComponent`. Wraps `App` in `Sentry.wrap` only when initialization succeeded. |
| Initialization | `src/telemetry/sentry.ts` | Reads `extra.sentryDsn` and `extra.releaseVersion` from the Expo config plus the native build number; returns `false` (no client) if any is missing. |
| Privacy policy | `src/telemetry/sentryPrivacy.ts` | `createSentryOptions()` fixes every SDK option; `scrubSentryEvent()` is the JavaScript `beforeSend` allowlist. |
| Native privacy | `patches/@sentry+react-native+7.11.0.patch` | Adds `BillManagerSentryPrivacy` (Android Java, iOS Objective-C) so native crash events get the same allowlist, and keeps Hermes `InternalBytecode.js` frames out of the app source map. Applied by `patch-package` on `npm install`/`npm ci`. |
| Build config | `app.config.ts`, `metro.config.js` | Registers the `@sentry/react-native/expo` plugin (source-map and Android native-symbol upload) and the Sentry Metro serializer that injects debug IDs. |

`SENTRY_DSN` is read from the environment when `app.config.ts` is evaluated and
copied into `extra.sentryDsn`, so it ends up inside the app bundle. A DSN is a
public routing key, but EAS stores it with `SENSITIVE` visibility. The upload
token `SENTRY_AUTH_TOKEN` is build-time only and is never put in app config.

## Enabling and disabling

- **Local development / `npm start`:** leave `SENTRY_DSN` unset. Nothing is
  reported.
- **EAS `preview` and `production` builds:** `SENTRY_DSN` (`SENSITIVE`) and
  `SENTRY_AUTH_TOKEN` (`SECRET`) must exist in the matching EAS environment.
  Release workflows fail before building if either is missing or has the wrong
  visibility. Run the same metadata-only check yourself with `EXPO_TOKEN` set
  in the environment:

  ```bash
  cd apps/mobile
  node scripts/verify-sentry-eas-environment.mjs --environment preview
  node scripts/verify-sentry-eas-environment.mjs --environment production
  ```

- **Disable for a build:** remove `SENTRY_DSN` from that EAS environment and
  rebuild. Already-installed binaries keep the DSN they were built with until
  users install a new build.
- **Environment label:** the EAS update channel (`Updates.channel`) when
  present, otherwise `development` in `__DEV__` and `production` elsewhere.

## Release identity

Events are tagged with:

- `release`: `mobile-v<package.json version>` (for example `mobile-v1.1.1`)
- `dist`: `<android|ios>-<native build number>`

`initializeSentry()` refuses to start if the release version or native build
number is empty, and `sentryRelease`/`sentryDist` throw on characters outside
`[0-9A-Za-z.+-]` / `[0-9A-Za-z._-]`. This keeps events associated with the
source maps and symbols uploaded by the same build. Bumping the mobile version
therefore changes the Sentry release automatically.

## What is and is not sent

Fixed in `createSentryOptions()` (covered by `sentryPrivacy.test.ts`):

- Enabled: JS errors, native crash handling (`enableNativeCrashHandling` on
  Android/iOS), stack traces, and automatic session tracking for crash-free
  health. `sampleRate` is 1.
- Disabled: default PII, breadcrumbs (`maxBreadcrumbs: 0`), screenshots, view
  hierarchy, thread attachment, failed-request capture, tracing, profiling,
  replay, logs, app-start/frames/stall/hang/watchdog tracking, trace
  propagation, and NDK scope sync.

`scrubSentryEvent()` builds a new event from an allowlist instead of deleting
known-sensitive keys, so new SDK fields are dropped by default:

- Kept: event ID, timestamp, level, platform, release, dist, environment,
  sanitized SDK name/version/packages, exception and mechanism type (only if it
  looks like an identifier), and stack frames limited to canonical bundle names
  (`index*.bundle`, `main.jsbundle`), bounded code symbols, line/column numbers,
  debug IDs and native addresses.
- Replaced with `[redacted]`: exception values, messages, native image code
  paths.
- Removed: user, request, contexts, tags, extras, breadcrumbs, modules,
  registers, frame variables, non-canonical file paths, and attachments.

Anonymous SDK installation IDs and per-session UUIDs remain, by owner decision,
so distinct-installation and session-health metrics work. They are not account
IDs and must be disclosed in store privacy forms.

Mobile crash reporting is independent of server usage telemetry and its consent
setting (see [TELEMETRY.md](../../../TELEMETRY.md)).

## Working on it

Tests and checks (from `apps/mobile`):

```bash
# privacy allowlist, options, frame rewriting, EAS metadata and inspection helpers
npx vitest run src/telemetry scripts
npm run config:validate
```

Guidelines:

- **Adding event data:** extend the allowlist in both `sentryPrivacy.ts` and the
  native `BillManagerSentryPrivacy` classes in the patch, add a canary to
  `sentryPrivacy.test.ts`, and update this page and the store privacy answers.
  Do not add `Sentry.setUser`, tags, breadcrumbs or `captureMessage` with
  user-derived text.
- **Upgrading `@sentry/react-native`:** the patch file name embeds the pinned
  version (`7.11.0`). After a bump, regenerate the patch against the new
  version, confirm `npm ci` applies it cleanly, and re-run the privacy and
  rewrite-frames tests. `.github/dependabot.yml` ignores this package because it is
  pinned by Expo's native-module matrix.
- **Source maps and native symbols:** the Android Gradle integration
  (`experimental_android` in `app.config.ts`) uploads native symbols and
  ProGuard/R8 mappings; native source files and source context are excluded.
  An upload at build time does not prove Sentry received or symbolicated a
  crash; follow the evidence checklist in
  [development-builds.md](development-builds.md#sentry-setup-and-release-evidence).
- **Inspecting received events:** the protected Android release workflow action
  `inspect-sentry` runs `scripts/inspect-sentry-events.mjs`, which reports only
  counts and booleans (frame counts, whether user/request/breadcrumb data is
  present, whether exception values are unredacted), never event text.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| No events in a build | `SENTRY_DSN` was not set in that EAS environment at build time, or the build number/version was empty so `initializeSentry()` returned `false`. |
| Release workflow fails at the Sentry preflight | A required variable name is missing or has the wrong visibility (`SENTRY_DSN` must be `SENSITIVE`, `SENTRY_AUTH_TOKEN` `SECRET`). |
| Frames are unsymbolicated | Source maps or native symbols were not uploaded for that exact `release`/`dist`; check the build's upload logs and that the event's `dist` matches the build. |
| Hermes `InternalBytecode.js` frames appear as app code | The `@sentry/react-native` patch did not apply; re-run `npm ci` and check `postinstall` output. |
