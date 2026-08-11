# Development builds, CNG, EAS, and Mac workflow

BillManager Mobile requires an Expo development build. Expo Go cannot load the SQLCipher configuration, passkey modules, widgets, or native notification behavior used by this application.

## Prerequisites

- Node.js 24.19.0 and npm
- an Expo account with access to the existing `brdweb/billmanager-mobile` EAS project
- EAS CLI 16.28.0 or newer, or `npx eas-cli`
- Android Studio, Android SDK, an emulator or Android device, and a compatible JDK for local Android builds
- macOS with Xcode for local iOS builds, widget/passkey work, signing diagnosis, and final App Store checks

The EAS project ID, iOS bundle identifier, and Android application identifier are intentionally preserved in `app.config.ts`:

| Setting | Value |
|---|---|
| EAS project | `061766ea-b874-4027-bcbb-a24b395cb8b6` |
| iOS bundle ID | `com.brdweb.billmanager` |
| Android application ID | `com.brdweb.billmanagermobile` |

Do not change these values to work around signing or local installation problems. A change would break the in-place alpha upgrade and store identity.

## Install and validate JavaScript dependencies

From the repository root:

```bash
cd apps/mobile
npm ci
npm run check
```

The check command performs these steps:

1. fails when copied web catalogs or the generated Metro locale registry drift;
2. regenerates the OpenAPI TypeScript schema and fails on drift;
3. runs the mobile lint, TypeScript, and unit-test gates;
4. validates every Maestro flow definition;
5. checks Expo package compatibility;
6. runs Expo Doctor.

Useful focused commands:

```bash
npm run i18n:sync
npm run i18n:check
npm run api:generate
npm run lint
npm run typecheck
npm test
npm run maestro:validate
npx expo install --check
npm run doctor
```

Generated translation and API changes are real source changes. Review and commit them together with the web catalog or OpenAPI change that produced them.

## Create a development client with EAS

Authenticate once:

```bash
npx eas-cli login
```

Android internal development client:

```bash
npx eas-cli build --platform android --profile development
```

iOS simulator client:

```bash
npx eas-cli build --platform ios --profile development
```

iOS physical-device internal client:

```bash
npx eas-cli build --platform ios --profile development:device
```

After installing the matching development client, start Metro:

```bash
npm start
```

Use `npm run start:clear` after changing generated native configuration, Metro configuration, or native module exports.

## Local native builds and CNG

`ios/` and `android/` are generated, ignored directories. Durable native inputs live in:

- `app.config.ts` for identifiers, entitlements, transport policy, and config plugins;
- `widgets/` for the iOS widget source;
- `modules/billmanager-passkeys/` for iOS AuthenticationServices and Android Credential Manager;
- `modules/billmanager-widget/` for Android Jetpack Glance;
- Expo package/config plugin configuration in `package.json` and `app.config.ts`.

For local development builds, `npm run android` and `npm run ios` explicitly enable the development-only cleartext exception. Preview, release-candidate, and production profiles always generate HTTPS-only native policy.

Regenerate an HTTPS-only native project after changing any native input:

```bash
npm run prebuild
```

Use `npm run prebuild:development` only when a local development client must reach a cleartext HTTP server. `npm run android` and `npm run ios` select that development-only policy automatically.

The script runs translation synchronization followed by `expo prebuild --clean`. It deletes and recreates the generated native projects. Do not make durable edits directly inside `ios/` or `android/`; move a necessary change into Expo config, a config plugin, a widget, or a local Expo module first.

Run Android locally:

```bash
npm run android
```

### Direct signed Android phone-test APK on Windows

Use `scripts/build-local-android.ps1` for a standalone release APK that can be
installed directly on a physical Android phone. This is not Expo Go, does not
require Metro, and uses the same upload certificate as the existing EAS Android
builds so it can replace an installed preview APK without clearing application
data.

The script deliberately builds only committed source. It creates a short-lived
Windows/NTFS snapshot under `C:\bm`, generates the Android project there, uses
Android Studio's bundled JDK and Android SDK toolchain, signs the release with
the existing EAS keystore, verifies the certificate against
`apps/web/public/.well-known/assetlinks.json`, disables Expo Updates so the
phone test always runs the embedded committed JavaScript, and removes the
snapshot. Commit the intended mobile changes before running it; uncommitted
changes are not part of the APK.

One-time signing setup is stored outside the repository and must remain readable
only by the Windows user running the build:

- `%LOCALAPPDATA%\BillManager\android-signing\credentials.json`
- `%LOCALAPPDATA%\BillManager\android-signing\keystore.jks`

Download the existing Android keystore through `npx eas-cli credentials
--platform android`; do not generate a replacement key and never copy either
credential file into the repository. The script also expects the preview
profile's pinned Windows Node.js version and the Android 36 SDK, Build Tools,
NDK, and CMake versions that it checks at startup.

From Windows PowerShell in `apps/mobile`, run:

```powershell
.\scripts\build-local-android.ps1
```

The result is written under `output/play-store-assets/` at the repository root.
It is an ARM64 phone-test APK, not the multi-architecture Android App Bundle
submitted to Google Play. Before accepting the candidate, install it as an
update rather than uninstalling the current app, then test password login,
Google/Apple/Microsoft SSO, and both passkey registration and login through the
device's credential manager (including Bitwarden).

After Play App Signing is enabled, the Play-distributed application normally
uses the Play app-signing certificate rather than the EAS upload certificate.
Add the Play Console App Integrity SHA-256 fingerprint to both Digital Asset
Links and the server's trusted Android WebAuthn origins before testing passkeys
from a Play-installed build.

Run iOS locally on the Mac:

```bash
npm run ios
```

Before reporting a native issue, reproduce it from a clean `npm ci` and clean prebuild so generated-project drift is not mistaken for an application defect.

## EAS profiles

| Profile | Purpose | Distribution/transport behavior |
|---|---|---|
| `development` | Android device/emulator or iOS simulator dev client | Internal distribution, development channel, development HTTP allowed |
| `development:device` | Physical iOS dev client | Internal distribution, development channel, development HTTP allowed |
| `preview` | General internal release-candidate testing | Internal distribution, preview channel, HTTPS-only native policy |
| `preview:ios` | Physical iOS internal preview | Internal distribution, preview channel, HTTPS-only native policy |
| `production` | Store candidate only | Production channel, auto-increment, HTTPS-only release configuration |

Only `development` and `development:device` set `BILLMANAGER_DEVELOPMENT_BUILD=true`; `preview`, `preview:ios`, and `production` explicitly set it to `false`, and the app configuration defaults to HTTPS-only when the flag is absent. `npm run config:validate` checks these generated policies in CI. The final transport-security gate must still be tested against a production-profile binary rather than inferred from configuration alone.

Routine cloud builds and submissions use EAS:

```bash
npx eas-cli build --platform all --profile production
npx eas-cli submit --platform ios --profile production
npx eas-cli submit --platform android --profile production
```

These commands are documentation, not authorization to publish. Do not run a production submission until both stores pass the release gates in [implementation-status.md](implementation-status.md) and a release owner explicitly approves publication.

## Mac and Xcode responsibilities

One Mac is sufficient because EAS can perform repeatable routine builds, but these tasks remain Mac-specific:

- regenerate and compile the iOS project after config/native-module changes;
- run simulator and physical-device tests;
- verify Swift module and CocoaPods integration;
- complete passkey registration and assertion ceremonies with Associated Domains;
- install and refresh the WidgetKit extension and inspect app-group data;
- validate universal links and OAuth return links;
- inspect entitlements, privacy manifests, signing identities, provisioning profiles, and capabilities;
- archive the production configuration and run Xcode/App Store validation;
- diagnose store-only crashes with organizer logs and dSYMs.

Do not treat a successful EAS iOS compile as a substitute for physical-device passkey, notification, widget, universal-link, and accessibility tests.

### Passkey signing configuration

Android Credential Manager identifies a native app with an `android:apk-key-hash:` WebAuthn origin derived from its signing certificate. Add every trusted debug, preview, and release origin to the server's comma-separated `WEBAUTHN_ANDROID_ORIGINS` setting and publish matching Digital Asset Links metadata for the Android application ID and certificate.

iOS Associated Domains are part of the signed binary. The public build includes `app.billmanager.app`. A self-hosted distribution that needs native passkeys must set `BILLMANAGER_IOS_PASSKEY_DOMAINS=bills.example.com` (comma-separated for multiple relying parties) before prebuild/signing, publish the matching `apple-app-site-association` file, and ship a new binary. JavaScript updates cannot add a relying-party entitlement.

## EAS Update boundary

The runtime version follows the application version. EAS Update may be used only when the update changes JavaScript or assets and is compatible with the native runtime already installed.

A new store binary is required for changes to:

- Expo or React Native versions;
- native dependencies or config plugins;
- `app.config.ts` entitlements, permissions, identifiers, or transport policy;
- Swift, Kotlin, WidgetKit, Credential Manager, Glance, SQLCipher, or notification categories;
- any data migration that depends on new native code.

When uncertain, issue a new binary.
