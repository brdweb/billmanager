# Manual native iOS Simulator QA

The **iOS Simulator QA** workflow is a separate, manual lane for reviewed `main`.
It builds the checked-out source locally on a standard GitHub-hosted macOS 26
ARM64 runner with Xcode 26.6, Node 24.19.0 and two native build jobs. The job is
limited to 90 minutes. Standard runners are compute-free for this public
repository; artifacts use the account's storage allowance and expire in 3 days.
No larger runner or EAS build is used. The default anonymous mode uses no
production environment or account credential; approved optional capture is described below.

The workflow generates the iOS project from the committed Expo configuration,
installs CocoaPods, and builds a **Release iOS Simulator** `.app` without device
signing. Only the active ARM64 Simulator architecture is compiled, and the actual
app executable must report exactly `arm64` before installation. SQLCipher, widgets and local Expo modules are compiled. The installed
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
JUnit report, screenshots, native build logs and the unsigned
`.app.zip`. The manifest records source commit/tree, mobile version, toolchain,
Simulator identity, actual binary architectures, exceptions and SHA-256 hashes of the app archive and embedded
JavaScript. Check the job result and report; logs or screenshots alone do not
establish a passing run. Failed builds still upload allowlisted native diagnostic output. Private authenticated diagnostics are never uploaded.

The job prints phase starts for prebuild, CocoaPods, native compilation, installation
and Maestro; full compiler output remains in the retained build log. Before
dispatching another run, inspect workflow concurrency: `cancel-in-progress: true`
means a new run can cancel an existing build rather than queue behind it.

This lane does not establish physical-device, App Store signing, authenticated
bill/payment synchronization, OAuth/passkeys, real notifications, accessibility
or production Sentry acceptance. Those remain separate candidate gates.

Sources: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[runner image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md),
[Expo SDK requirements](https://docs.expo.dev/versions/latest/),
[Maestro iOS](https://docs.maestro.dev/get-started/supported-platform/ios).

The lane now compiles once and installs sequentially on an iPhone and a 13-inch
(or 12.9-inch) iPad Simulator. Missing either family fails rather than claiming
coverage. The default remains anonymous. An optional `authenticated=true` dispatch
uses the existing protected `ios-production` approval gate. Only its separate,
post-build capture step receives the temporary `QA_REVIEWER_PASSWORD` secret;
remove that secret after the approved capture. Production app source is unchanged.

Authenticated capture verifies synthetic owner 25, sole group 23, manual Pro,
four DEMO bills, two scoped payments and empty settlements through HTTPS login
and GETs before UI login. Mobile history starts at Any date. It uses the real
embedded app and server data, with no account/data edits, payment actions or
purchases. Maestro password input can appear in diagnostics: all raw flows,
logs, hierarchy, failure images and Maestro HOME are private runner-temporary
siblings of the upload directory and are deleted on completion or failure.
No login or automatic final-screen image is published. Only after both devices
pass all assertions are eight explicitly named post-auth PNGs promoted. Their
native dimensions must match the accepted iPhone 1206×2622 and iPad 2048×2732 or
2064×2752 sizes. There is no resizing, framing or fabricated data. The uploader
uses an explicit allowlist; sanitized counts, source, devices, dimensions and
hashes accompany the PNGs. Any failure publishes only a controlled failure code,
not raw authenticated diagnostics. Inspect these screenshots before store upload;
this does not replace physical-device or production diagnostics acceptance.

The private driver uses the Maestro-supported `MAESTRO_` shell-variable prefix
([official parameters reference](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/parameters-and-constants)); no secret is passed through `-e` arguments.
