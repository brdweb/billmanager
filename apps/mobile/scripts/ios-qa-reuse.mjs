import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { selectDevices } from './ios-qa-devices.mjs';
export const REUSE = { run: 41054807810, source: '1b51cd6edc7a31265cb94b338113f355a49ae175',
  archiveSha256: 'a6858200b085981fab88fdf6a3759decfc64258d4fe51629bb72f3074563e622' };
const ensure = condition => { if (!condition) throw new Error('Untrusted Simulator archive rejected'); };
export function validateReuse(run, jobs, manifest, result, archiveHash) {
  ensure(run.id === REUSE.run && run.event === 'workflow_dispatch' && run.head_branch === 'main' && run.head_sha === REUSE.source);
  ensure(run.repository?.full_name === 'brdweb/billmanager' && run.head_repository?.full_name === 'brdweb/billmanager');
  ensure(run.path === '.github/workflows/ios-simulator-qa.yml' && run.status === 'completed');
  ensure(jobs.jobs?.some(job => job.name === 'Native Release simulator smoke' && job.steps?.some(step =>
    step.name === 'Build and exercise the native Simulator app' && step.conclusion === 'success')));
  ensure(manifest.sourceCommit === REUSE.source && manifest.appArchiveSha256 === REUSE.archiveSha256 && archiveHash === REUSE.archiveSha256);
  ensure(manifest.configuration === 'Release' && manifest.platform === 'iOS Simulator' && manifest.mobileVersion === '1.2.0');
  ensure(JSON.stringify(manifest.binaryArchitectures) === '["arm64"]' && manifest.productionTransport === true && manifest.signing === false);
  ensure(manifest.designPreview === false && manifest.generatedOtaEnabled === false && manifest.sentryUploadEnabled === false && manifest.sentryDsnConfigured === false);
  ensure(result.exitCode === 0);
}
export function prepareReuse(incoming, runnerTemp) {
  const json = file => JSON.parse(readFileSync(join(incoming, file), 'utf8'));
  const manifest = json('manifest.json');
  const archive = join(incoming, 'BillManager-simulator.app.zip');
  const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  validateReuse(json('run.json'), json('jobs.json'), manifest, json('result.json'), hash(archive));
  const output = join(runnerTemp, 'billmanager-ios-qa'); mkdirSync(output, { recursive: true });
  const appParent = join(runnerTemp, 'billmanager-ios-derived/Build/Products/Release-iphonesimulator');
  mkdirSync(appParent, { recursive: true });
  execFileSync('ditto', ['-x', '-k', archive, appParent], { stdio: 'ignore' });
  const app = join(appParent, 'BillManager.app');
  const plist = (file, key) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(app, file)], { encoding: 'utf8' }).trim();
  const executable = plist('Info.plist', 'CFBundleExecutable'); ensure(!/[\\/]/.test(executable));
  ensure(execFileSync('xcrun', ['lipo', '-archs', join(app, executable)], { encoding: 'utf8' }).trim() === 'arm64');
  ensure(plist('Info.plist', 'CFBundleSupportedPlatforms:0') === 'iPhoneSimulator');
  ensure(plist('Info.plist', 'CFBundleIdentifier') === 'com.brdweb.billmanager' && plist('Info.plist', 'CFBundleShortVersionString') === '1.2.0');
  ensure(plist('Info.plist', 'NSAppTransportSecurity:NSAllowsArbitraryLoads') === 'false');
  ensure(plist('Info.plist', 'NSAppTransportSecurity:NSAllowsLocalNetworking') === 'false' && plist('Expo.plist', 'EXUpdatesEnabled') === 'false');
  ensure(hash(join(app, 'main.jsbundle')) === manifest.embeddedJavaScriptSha256);
  const config = JSON.parse(readFileSync(join(app, 'EXConstants.bundle/app.config'), 'utf8'));
  ensure(config.extra?.buildEnvironment === 'production' && config.extra.allowCleartextDevelopmentServers === false && !config.extra.sentryDsn);
  const devices = selectDevices(JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' })));
  copyFileSync(archive, join(output, 'BillManager-simulator.app.zip'));
  writeFileSync(join(output, 'selected-devices.json'), JSON.stringify(devices, null, 2));
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ ...manifest, captureDevices: devices,
    captureHarnessCommit: process.env.GITHUB_SHA, reusedNativeBuildRun: REUSE.run,
    acceptance: 'verified reused native build only; separate store-capture.json must pass' }, null, 2));
  writeFileSync(join(output, 'binary-architectures.txt'), 'arm64\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try { prepareReuse(process.argv[2], process.env.RUNNER_TEMP); }
  catch { console.error('Reviewed Simulator archive verification failed; capture not started.'); process.exitCode = 1; }
}
