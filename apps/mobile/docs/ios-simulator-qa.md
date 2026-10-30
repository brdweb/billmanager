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
logs, hierarchy and failure images use private runner-temporary siblings of the
upload directory and are deleted on completion or failure. Standard HOME is not
changed; any CLI global state stays on the ephemeral runner with umask 077 and
is never allowlisted for upload.
No login or automatic final-screen image is published. Only after both devices
pass all assertions are eight explicitly named post-auth PNGs promoted. Their
native dimensions must match the accepted iPhone 1206×2622 and iPad 2048×2732 or
2064×2752 sizes. There is no resizing, framing or fabricated data. The uploader
uses an explicit allowlist; sanitized counts, source, devices, dimensions and
hashes accompany the PNGs. Any failure publishes only a controlled failure code and stage,
not raw authenticated diagnostics. Inspect these screenshots before store upload;
this does not replace physical-device or production diagnostics acceptance.

The private driver uses the Maestro-supported `MAESTRO_` shell-variable prefix
([official parameters reference](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/parameters-and-constants)); no secret is passed through `-e` arguments.

Capture-only diagnosis may set `reuse_reviewed_build=true` together with
`authenticated=true`. This accepts only the pinned native archive from manual
main run 41054807810, source `1b51cd6`, SHA-256
`a6858200b085981fab88fdf6a3759decfc64258d4fe51629bb72f3074563e622`.
That run compiled successfully but failed at private `iphone-login`, producing
no promoted PNGs. Deleted private diagnostics cannot identify its exact failing
command; this is not evidence of an application or selector defect.

Before extracting or installing the archive, the helper verifies repository,
manual main-run/workflow identity, successful native build step, exact source,
archive hash and Release manifest. It then verifies the actual ARM64 Simulator
binary, HTTPS/OTA settings, embedded JavaScript hash and production/non-debug
app configuration. Fresh runner device identifiers replace the old identifiers.
The manifest retains the original compiled source and records the new capture
harness commit and reused build run. The protected approval and separate secret
step remain mandatory; reuse never accepts arbitrary PR or fork artifacts.

On a private command failure, only fixed process/category enums, numeric exit
status, and (when Maestro wrote its command report) a bounded failed command
ordinal/type/status are published. Command values, selectors, exception text,
hierarchy and images remain private and are deleted. Missing/truncated reports
produce no invented command diagnosis. The parser follows the pinned
[Maestro 2.12 command-report schema](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.12.0/maestro-orchestra/src/main/kotlin/maestro/orchestra/debug/TestOutputWriter.kt).
The capture-only retry is diagnostic until every native flow actually passes.

The first archive-reuse retry (41070745696) passed native verification but failed
identity preflight before any UI command. The coordinator's subsequent safe
read-back confirmed one additional payment in the synthetic tenant: the original
payment IDs 654/655 remained, and all three payments belonged to group 23 and
approved DEMO bills 71–74. The previous exact-two count was therefore stale;
the origin of the additional payment is unknown. Preflight now permits 2–100
unique payments only within those exact approved tenant/bill boundaries and
requires both original payments. It reports the actual count without deleting
or changing any reviewer data. Four expected DEMO bills, sole owner/tenant, Pro,
no portal, and empty settlements remain mandatory.

Preflight failures publish only fixed substage/category enums and a numeric HTTP
status when applicable. They distinguish local device metadata, login, identity,
billing, bills, payments and settlements from UI failures without publishing
responses, tokens or exception text. This corrects a confirmed QA preflight
assumption; the original native iPhone login failure is still unresolved and
has not prompted speculative selector, timeout or application changes.

Run 41074824488 passed identity but timed out in the grouped simulator setup
stage. It did not identify which setup command stalled. Preparation now runs
without reviewer credentials, serially booting, checking, installing and shutting
down each device before the secret step. A precise stage and elapsed/budget
milliseconds accompany each command. Only `bootstatus -b` gets 600 seconds; state,
locale, installation and shutdown retain 180-second limits. Readiness requires
both successful bootstatus and an explicit Booted state; Booted alone is not
accepted. Private capture repeats bounded warm-boot readiness. Cleanup targets
only the selected task devices and records the observed final state, preserving
the original failure if cleanup also fails. No raw output or failure images are
added to the upload allowlist.

Preparation selects the installed runtime matching the active Simulator SDK and
requires the retained archive's DTSDKName to match. The reviewed archive uses
`iphonesimulator26.5`; the earlier first-device selector chose iOS 26.4. Runtime
alignment is justified hardening, not a proven explanation of the timeout: the
earlier anonymous run succeeded on 26.4. Missing matching runtime fails closed;
no runtime download or larger runner is requested. Full native PNG dimensions,
all-eight success and privacy checks remain unchanged. See the
[GitHub runner inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)
and [Chromium's bootstatus readiness semantics](https://chromium.googlesource.com/chromium/src/+/93b31d4424cb0fddb7cb5a901f21eb9859270658/ios/build/bots/scripts/iossim_util.py).
