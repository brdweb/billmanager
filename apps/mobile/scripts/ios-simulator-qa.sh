#!/usr/bin/env bash
# Manual, credential-free CI lane. Never submits or builds a signed device app.
set -euo pipefail

mobile_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$mobile_root"
output="${RUNNER_TEMP:?GitHub runner temporary directory is required}/billmanager-ios-qa"
mkdir -p "$output"
simulator_id=''
finish() {
  status=$?
  trap - EXIT
  if [[ -n "$simulator_id" ]]; then
    xcrun simctl shutdown "$simulator_id" >/dev/null 2>&1 || true
  fi
  printf '{"exitCode":%s,"acceptance":"simulator-only"}\n' "$status" > "$output/result.json"
  exit "$status"
}
trap finish EXIT

[[ "${BILLMANAGER_DEVELOPMENT_BUILD:-}" == false ]]
[[ "${EXPO_PUBLIC_DESIGN_PREVIEW:-}" == 0 ]]
[[ "${SENTRY_DISABLE_AUTO_UPLOAD:-}" == true ]]
[[ -z "${SENTRY_DSN:-}${SENTRY_AUTH_TOKEN:-}${EXPO_TOKEN:-}" ]]
[[ "$(uname -s)" == Darwin ]]
xcodebuild -version | tee "$output/xcode.txt"
java -version > "$output/java.txt" 2>&1
maestro --version > "$output/maestro.txt"
pod --version > "$output/cocoapods.txt"
uname -a > "$output/runner.txt"
node -e 'const {execFileSync}=require("node:child_process"); const v=execFileSync("xcodebuild",["-version"],{encoding:"utf8"}).match(/Xcode (\d+)\.(\d+)/); if(!v || +v[1]<26 || (+v[1]===26 && +v[2]<4)) process.exit(1)'

printf 'QA phase: prebuild\n'
npx expo prebuild --clean --platform ios --no-install > "$output/prebuild.log" 2>&1
# Keep native app transport production-strict. Disable only generated OTA so
# this QA run cannot replace its exact checked-out JS bundle with a remote OTA.
app_info=ios/BillManager/Info.plist
updates_plist=ios/BillManager/Supporting/Expo.plist
[[ "$(/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsArbitraryLoads' "$app_info")" == false ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsLocalNetworking' "$app_info")" == false ]]
/usr/libexec/PlistBuddy -c 'Set :EXUpdatesEnabled false' "$updates_plist"
git diff HEAD --exit-code > "$output/source-diff.txt"
printf 'QA phase: pods\n'
pod install --project-directory=ios > "$output/pods.log" 2>&1

xcrun simctl list devices available -j > "$output/devices.json"
node scripts/ios-qa-devices.mjs "$output/devices.json" > "$output/selected-devices.json"
simulator_id="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1]))[0].udid' "$output/selected-devices.json")"
xcrun simctl boot "$simulator_id" || [[ "$(xcrun simctl list devices booted -j)" == *"$simulator_id"* ]]
xcrun simctl bootstatus "$simulator_id" -b
xcrun simctl spawn "$simulator_id" defaults write NSGlobalDomain AppleLanguages -array en
xcrun simctl spawn "$simulator_id" defaults write NSGlobalDomain AppleLocale en_US

printf 'QA phase: compile (Release, active ARM64 Simulator architecture)\n'
xcodebuild -workspace ios/BillManager.xcworkspace -scheme BillManager \
  -configuration Release -sdk iphonesimulator -destination "id=$simulator_id" \
  -derivedDataPath "$RUNNER_TEMP/billmanager-ios-derived" -jobs 2 \
  ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build > "$output/xcode-build.log" 2>&1
app="$RUNNER_TEMP/billmanager-ios-derived/Build/Products/Release-iphonesimulator/BillManager.app"
[[ -f "$app/main.jsbundle" ]]
executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist")"
xcrun lipo -archs "$app/$executable" | tee "$output/binary-architectures.txt"
[[ "$(cat "$output/binary-architectures.txt")" == arm64 ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$app/Info.plist")" == iPhoneSimulator ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")" == com.brdweb.billmanager ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsArbitraryLoads' "$app/Info.plist")" == false ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsLocalNetworking' "$app/Info.plist")" == false ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :EXUpdatesEnabled' "$app/Expo.plist")" == false ]]
git diff HEAD --exit-code >> "$output/source-diff.txt"
ditto -c -k --sequesterRsrc --keepParent "$app" "$output/BillManager-simulator.app.zip"
node - "$output" "$app" "$simulator_id" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const [output, app, udid] = process.argv.slice(2);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', args, {encoding:'utf8'}).trim();
fs.writeFileSync(`${output}/manifest.json`, JSON.stringify({
  sourceCommit: git('rev-parse','HEAD'), sourceTree: git('rev-parse','HEAD^{tree}'),
  mobileVersion: JSON.parse(fs.readFileSync('package.json','utf8')).version,
  configuration:'Release', platform:'iOS Simulator', simulatorUdid:udid,
  captureDevices:JSON.parse(fs.readFileSync(`${output}/selected-devices.json`,'utf8')),
  binaryArchitectures:fs.readFileSync(`${output}/binary-architectures.txt`,'utf8').trim().split(/\s+/),
  productionTransport:true, signing:false, designPreview:false,
  generatedOtaEnabled:false, sentryUploadEnabled:false, sentryDsnConfigured:false,
  appArchiveSha256:hash(`${output}/BillManager-simulator.app.zip`),
  embeddedJavaScriptSha256:hash(`${app}/main.jsbundle`),
  nodeVersion:process.version, acceptance:process.env.IOS_QA_AUTHENTICATED === 'true'
    ? 'compile only; separate store-capture.json must pass' : 'compile and anonymous auth-entry navigation only',
}, null, 2));
NODE
# Authenticated capture is a separate post-build step: no password exists here.
if [[ "${IOS_QA_AUTHENTICATED:-false}" == true ]]; then
  xcrun simctl shutdown "$simulator_id"
  simulator_id=''
  exit 0
fi
# One compiled ARM64 Simulator app serves both device families, sequentially.
for family in iphone ipad; do
  simulator_id="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).find(d => d.family === process.argv[2]).udid' "$output/selected-devices.json" "$family")"
  device_output="$output/$family"
  mkdir -p "$device_output"
  xcrun simctl boot "$simulator_id" || [[ "$(xcrun simctl list devices booted -j)" == *"$simulator_id"* ]]
  xcrun simctl bootstatus "$simulator_id" -b
  xcrun simctl spawn "$simulator_id" defaults write NSGlobalDomain AppleLanguages -array en
  xcrun simctl spawn "$simulator_id" defaults write NSGlobalDomain AppleLocale en_US
  printf 'QA phase: install (%s)\n' "$family"
  xcrun simctl install "$simulator_id" "$app"
  printf 'QA phase: Maestro anonymous auth-entry smoke (%s)\n' "$family"
  maestro --device "$simulator_id" test .maestro/ios/auth-entry.yaml \
    --format JUNIT --output "$device_output/maestro.xml" \
    --test-output-dir "$device_output/screenshots" --debug-output "$device_output/maestro-debug"
  xcrun simctl shutdown "$simulator_id"
  simulator_id=''
done
