import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { selectDevices } from './ios-qa-devices.mjs';
const REPOSITORY = 'brdweb/billmanager';
const SHA = /^[0-9a-f]{40}$/;
const ensure = condition => { if (!condition) throw new Error('Untrusted Simulator archive rejected'); };
export function parseRunId(value) {
  ensure(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value));
  const id = Number(value); ensure(Number.isSafeInteger(id)); return id;
}
// A pinned run must be a completed manual main run of this workflow whose native build
// step succeeded, with exactly one unexpired artifact for its own commit. When the
// comparison is supplied, that commit must also be contained in the current main.
export function validatePinnedRun(requestedId, run, jobs, artifacts, comparison) {
  const runId = parseRunId(requestedId);
  ensure(run.id === runId && run.event === 'workflow_dispatch' && run.head_branch === 'main' && SHA.test(run.head_sha));
  ensure(run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY);
  ensure(run.path === '.github/workflows/ios-simulator-qa.yml' && run.status === 'completed');
  ensure(jobs.jobs?.some(job => job.name === 'Native Release simulator smoke' && job.steps?.some(step =>
    step.name === 'Build and exercise the native Simulator app' && step.conclusion === 'success')));
  const artifactName = `ios-simulator-qa-${run.head_sha}`;
  const matching = artifacts.artifacts?.filter(artifact => artifact.name === artifactName) ?? [];
  ensure(Number.isInteger(artifacts.total_count) && artifacts.total_count <= 100 && matching.length === 1);
  ensure(matching[0].expired === false && matching[0].workflow_run?.id === runId && matching[0].workflow_run.head_sha === run.head_sha);
  if (comparison !== undefined) {
    ensure(['ahead', 'identical'].includes(comparison.status) && comparison.base === run.head_sha && comparison.merge_base === run.head_sha);
  }
  return { runId, source: run.head_sha, artifactName };
}
export function validateReuse(pinned, manifest, result, archiveHash, mobileVersion) {
  ensure(manifest.sourceCommit === pinned.source && /^[0-9a-f]{64}$/.test(archiveHash) && manifest.appArchiveSha256 === archiveHash);
  ensure(manifest.configuration === 'Release' && manifest.platform === 'iOS Simulator' && manifest.mobileVersion === mobileVersion);
  ensure(JSON.stringify(manifest.binaryArchitectures) === '["arm64"]' && manifest.productionTransport === true && manifest.signing === false);
  ensure(manifest.designPreview === false && manifest.generatedOtaEnabled === false && manifest.sentryUploadEnabled === false && manifest.sentryDsnConfigured === false);
  ensure(result.exitCode === 0);
}
const readJson = (directory, file) => JSON.parse(readFileSync(join(directory, file), 'utf8'));
const pinnedRun = (metadata, requestedId, comparison) =>
  validatePinnedRun(requestedId, readJson(metadata, 'run.json'), readJson(metadata, 'jobs.json'), readJson(metadata, 'artifacts.json'), comparison);
export function prepareReuse(metadata, incoming, requestedId, runnerTemp) {
  const pinned = pinnedRun(metadata, requestedId, readJson(metadata, 'comparison.json'));
  const json = file => readJson(incoming, file);
  const manifest = json('manifest.json');
  const archive = join(incoming, 'BillManager-simulator.app.zip');
  const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const mobileVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  validateReuse(pinned, manifest, json('result.json'), hash(archive), mobileVersion);
  const output = join(runnerTemp, 'billmanager-ios-qa'); mkdirSync(output, { recursive: true });
  const appParent = join(runnerTemp, 'billmanager-ios-derived/Build/Products/Release-iphonesimulator');
  mkdirSync(appParent, { recursive: true });
  execFileSync('ditto', ['-x', '-k', archive, appParent], { stdio: 'ignore' });
  const app = join(appParent, 'BillManager.app');
  const plist = (file, key) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(app, file)], { encoding: 'utf8' }).trim();
  const executable = plist('Info.plist', 'CFBundleExecutable'); ensure(!/[\\/]/.test(executable));
  ensure(execFileSync('xcrun', ['lipo', '-archs', join(app, executable)], { encoding: 'utf8' }).trim() === 'arm64');
  ensure(plist('Info.plist', 'CFBundleSupportedPlatforms:0') === 'iPhoneSimulator');
  ensure(plist('Info.plist', 'CFBundleIdentifier') === 'com.brdweb.billmanager' && plist('Info.plist', 'CFBundleShortVersionString') === mobileVersion);
  ensure(plist('Info.plist', 'NSAppTransportSecurity:NSAllowsArbitraryLoads') === 'false');
  ensure(plist('Info.plist', 'NSAppTransportSecurity:NSAllowsLocalNetworking') === 'false' && plist('Expo.plist', 'EXUpdatesEnabled') === 'false');
  ensure(hash(join(app, 'main.jsbundle')) === manifest.embeddedJavaScriptSha256);
  const config = JSON.parse(readFileSync(join(app, 'EXConstants.bundle/app.config'), 'utf8'));
  ensure(config.extra?.buildEnvironment === 'production' && config.extra.allowCleartextDevelopmentServers === false && !config.extra.sentryDsn);
  const devices = selectDevices(JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' })));
  copyFileSync(archive, join(output, 'BillManager-simulator.app.zip'));
  writeFileSync(join(output, 'selected-devices.json'), JSON.stringify(devices, null, 2));
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ ...manifest, captureDevices: devices,
    captureHarnessCommit: process.env.GITHUB_SHA, reusedNativeBuildRun: pinned.runId,
    acceptance: 'verified reused native build only; separate store-capture.json must pass' }, null, 2));
  writeFileSync(join(output, 'binary-architectures.txt'), 'arm64\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {
    // preflight <metadata> <run-id>: validate before download; print only the commit SHA.
    if (process.argv[2] === 'preflight') console.log(pinnedRun(process.argv[3], process.argv[4]).source);
    else prepareReuse(process.argv[2], process.argv[3], process.argv[4], process.env.RUNNER_TEMP);
  } catch { console.error('Pinned Simulator archive verification failed; capture not started.'); process.exitCode = 1; }
}
