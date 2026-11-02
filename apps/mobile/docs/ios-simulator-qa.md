# Manual native iOS Simulator QA

The **iOS Simulator QA** workflow is a separate, manual lane for reviewed `main`.
It builds the checked-out source locally on a standard GitHub-hosted macOS 26
ARM64 runner with Xcode 26.6, Node 24.19.0 and two native build jobs. The job is
limited to 90 minutes. Standard runners are compute-free for this public
repository; artifacts use the account's storage allowance and expire in 14 days.
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
establish a passing run. Failed builds still upload allowlisted native diagnostic output. Private authenticated diagnostics are never uploaded in plaintext (see sealed failure diagnostics below).

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
not raw authenticated diagnostics.

Sealed failure diagnostics: when the `ios-production` environment variable
`QA_DIAGNOSTICS_AGE_RECIPIENT` holds an operator's public
[age](https://age-encryption.org) recipient, a failed capture archives the private
runner directory (raw Maestro output, debug screenshots and command reports, which
can contain the reviewer password) and uploads only
`sealed-capture-failure.tar.age`, encrypted to that recipient. The plaintext archive is
deleted before upload and the safe report records only `diagnostics.sealed`. Decrypt
locally with `age -d -i <private key> sealed-capture-failure.tar.age | tar -xzf -` in a
private directory, never commit or share the plaintext, and delete it after diagnosis.
Without the variable nothing is sealed or uploaded. Set the recipient only on the
`ios-production` environment (no repository or organization variable of that name),
because whoever holds the matching key can read the archive. The repository is
public, so the ciphertext is downloadable for the artifact's 14-day retention:
download it from the specific run with `gh run download <run-id>`, and rotate the
synthetic reviewer password after any run whose report shows `diagnostics.sealed: true`.
age is a pinned, checksum-verified release binary. The capture also raises Maestro's
XCTest driver startup timeout to five minutes for freshly prepared Simulators. Inspect these screenshots before store upload;
this does not replace physical-device or production diagnostics acceptance.

The private driver uses the Maestro-supported `MAESTRO_` shell-variable prefix
([official parameters reference](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/parameters-and-constants)); no secret is passed through `-e` arguments.

An authenticated dispatch builds fresh from the checked-out `main` by default.
To skip compilation for capture-only diagnosis, set `pinned_run_id` to the ID of
an earlier manual `main` run of this workflow together with `authenticated=true`.
The input replaces the previous hard-coded run 41054807810. That run's artifact
expired under the former 3-day retention, so the old reuse path could no longer
succeed. Choose a pinned run whose 14-day artifact is still listed. A build from
an older commit is acceptable only when its screens look identical to the
store build being described.

Before anything is downloaded, the run ID must be numeric. The run must be a
completed manual `main` run of this workflow in `brdweb/billmanager`, and its
native build step must have succeeded (an earlier reuse run is rejected). Exactly
one unexpired artifact named `ios-simulator-qa-<head_sha>` must belong to that
run and commit, and the GitHub compare API must show that commit contained in
the current `main`. After download, the same run and containment checks are
repeated. The manifest source must equal the run commit,
the archive SHA-256 must equal the manifest's, and the Release, version,
HTTPS, OTA and Sentry fields must pass. It then verifies the actual ARM64 Simulator
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

Run 41079174520 reached the private login flow on the iPhone and failed at
`iphone-login` after 148.5 of 180 seconds with category `unclassified` and no
recovered command. The categorizer did not recognize two Maestro 2.12 messages
the login flow can produce. One is `Couldn't hide the keyboard`: on iOS,
`hideKeyboard` is a short swipe, and the login screen's scroll view does not
dismiss the keyboard on drag. The other is `Assertion is false`, which an
`extendedWaitUntil` timeout produces. Either is a likely cause; neither is
proven. The new `No visible element found` mapping is defensive only: Maestro
2.12 emits it from `scrollUntilVisible`, which these flows do not use, and
`tapOn` or `assertVisible` failures still report `Element not found`.

The login flow is now six labelled steps: `launch`, `username`, `password`,
`submit`, `post-login` and `deep-link`. `hideKeyboard` is no longer used. Return
on the password field calls the form's `onSubmitEditing` submit and blurs it.
If an enabled **Sign in** button is still visible afterwards, the submit step
taps it once as a guarded fallback. It then waits for an enabled **Sign in**
button to disappear.
Selectors are unchanged from the shipped build 16 source (`81a9e78`): the
`auth-login-screen` ID, plus the second `^Username$`, `^Password$` and
`^Sign in$` matches. Each field's text label comes before its accessible input,
and the screen header comes before the button. Neither inputs nor the button
have test IDs in that source. This change does not modify app source. Between
`81a9e78` and current `main`, the app source changes are Android-only top
insets, plus minor dependency bumps such as `lucide-react-native` 1.61 to 1.65,
which can change icon glyphs. A pinned run can also come from an older commit.
Before uploading captures to App Store Connect, compare them visually with
build 16.

The login process limit is 420 seconds, and in-flow waits for the login screen,
navigation and first bill are 60 seconds. The read-only capture limit is 360
seconds. On failure, `store-capture.json` adds `failure.step` (one of the six
names) and `failure.stepSource`. The value `command_report` means the step came
from the labelled `runFlow` in Maestro's private `commands.json`. The value
`console` means it is the latest labelled step that the plain console output
reported as started. No step is reported when neither source names one.
Categories now include `element_not_found`, `assertion_false`,
`keyboard_not_hidden` and `app_launch_failed`. Only these fixed names leave the
private directory.
