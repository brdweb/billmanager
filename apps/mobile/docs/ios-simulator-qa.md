# Manual native iOS Simulator QA

The **iOS Simulator QA** workflow is a separate, manual lane for reviewed `main`.
It builds the checked-out source locally on a standard GitHub-hosted macOS 26
ARM64 runner with Xcode 26.6, Node 24.19.0 and two native build jobs. The job is
limited to 90 minutes. Standard runners are compute-free for this public
repository; artifacts use the account's storage allowance and expire in 3 days.
No larger runner, EAS build, production environment or account credential is used.

The workflow generates the iOS project from the committed Expo configuration,
installs CocoaPods, and builds a **Release iOS Simulator** `.app` without device
signing. SQLCipher, widgets and local Expo modules are compiled. The installed
app runs its embedded JavaScript without Metro or design-preview fixtures.

Production HTTPS-only transport is checked both before and after compilation.
Two deliberate QA exceptions are recorded in the manifest: OTA is disabled in
the generated `Expo.plist` so the exact source bundle runs, and Sentry routing
and uploads are disabled because this lane has no diagnostics credentials.
These generated settings never modify committed production configuration.
This app is consequently a Simulator QA artifact, not the production IPA.

The existing `.maestro/ios/auth-entry.yaml` exercises actual native login-field
visibility, password-recovery navigation and the server-selector entry. It takes
login and recovery screenshots. It never enters credentials or submits a login,
password-reset request, registration or purchase. The app may make its normal
anonymous HTTPS configuration requests to the public service. An unavailable
service can fail the smoke run and must be reported, not bypassed.

Download the workflow artifact to inspect `manifest.json`, `result.json`, the
JUnit report, screenshots, native build logs, Simulator logs and the unsigned
`.app.zip`. The manifest records source commit/tree, mobile version, toolchain,
Simulator identity, exceptions and SHA-256 hashes of the app archive and embedded
JavaScript. Check the job result and report; logs or screenshots alone do not
establish a passing run. Failed builds still upload available diagnostic output.

This lane does not establish physical-device, App Store signing, authenticated
bill/payment synchronization, OAuth/passkeys, real notifications, accessibility
or production Sentry acceptance. Those remain separate candidate gates.

Sources: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[runner image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md),
[Expo SDK requirements](https://docs.expo.dev/versions/latest/),
[Maestro iOS](https://docs.maestro.dev/get-started/supported-platform/ios).
