# Mobile device-flow release gates

These Maestro flows exercise the two app identifiers separately and intentionally remain device tests. Repository CI validates their YAML and required coverage markers, but does not claim to execute them without an installed app plus an Android emulator/device or an iOS simulator/device.

## Suites

| Tag | Runtime mode | Coverage |
|---|---|---|
| `auth` | Normal development build | Login entry, field accessibility, password-recovery navigation, and server-profile entry visibility |
| `preview` | Development build connected to Metro with `EXPO_PUBLIC_DESIGN_PREVIEW=1` | Monthly Pulse shell, all five primary tabs, and the offline/conflict queue entry and empty state |

The preview suite uses deterministic local sample data and does not authenticate or mutate a server. The conflict flow validates that the queue is reachable and renders its safe empty state. Creating and resolving a real `409` conflict requires the seeded integration environment and remains part of release-candidate manual/device testing; unit and contract tests cover conflict mapping and resolution logic in CI.

## Prerequisites

1. Install the Maestro CLI using the current [official installation instructions](https://docs.maestro.dev/getting-started/installing-maestro).
2. Install a BillManager development build on the target device. Expo Go is unsupported.
3. Start an Android emulator/device or, on macOS, an iOS simulator/device.
4. Keep the device locale in English for these baseline flows. German and accessibility acceptance runs remain separate release-matrix passes.

## Run authentication entry flows

Start Metro without design-preview mode:

```bash
cd apps/mobile
EXPO_PUBLIC_DESIGN_PREVIEW=0 npm run start:clear
```

In a second terminal, run one platform suite:

```bash
maestro test .maestro/android --include-tags=auth
maestro test .maestro/ios --include-tags=auth
```

Run only the command matching the connected platform. These flows do not enter credentials or call a sign-in endpoint.

## Run deterministic preview flows

Restart Metro with the preview fixture enabled:

```bash
EXPO_PUBLIC_DESIGN_PREVIEW=1 npm run start:clear
```

Then run one platform suite:

```bash
maestro test .maestro/android --include-tags=preview
maestro test .maestro/ios --include-tags=preview
```

For PowerShell, set the Metro environment variable with:

```powershell
$env:EXPO_PUBLIC_DESIGN_PREVIEW = '1'
npm run start:clear
```

Because `EXPO_PUBLIC_*` values are embedded in the JavaScript bundle, stop and restart Metro when switching between `auth` and `preview` suites.

## CI-safe validation

Run the same structural gate used by repository CI:

```bash
npm run maestro:validate
```

The validator parses every flow as strict YAML, checks the correct Android/iOS app identifier, rejects unrecognized commands, requires isolated `clearState` launches, and verifies that both platform suites retain auth, five-tab, and offline/conflict coverage. It does not substitute for an executed device run.

## Manual native Simulator lane

The credential-free [iOS Simulator QA workflow](../docs/ios-simulator-qa.md)
executes the iOS `auth` flow on a native Release Simulator app from reviewed
`main`, with production HTTPS policy and explicit generated OTA/Sentry
exceptions. It captures login/recovery screenshots and build/test evidence.
For local runs, use `--test-output-dir /tmp/billmanager-maestro` to keep
screenshots outside the source tree. This does not replace signed physical
candidate acceptance or authenticated device flows.
