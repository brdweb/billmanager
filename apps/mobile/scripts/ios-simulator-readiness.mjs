import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { selectDevices } from './ios-qa-devices.mjs';
export const BOOT_READY_TIMEOUT_MS = 600000;
const NORMAL_TIMEOUT_MS = 180000;
const ensure = value => { if (!value) throw new Error('Simulator preparation boundary failed'); };
export function deviceState(inventory, udid) {
  const device = Object.values(inventory.devices ?? {}).flat().find(item => item.udid === udid);
  return ['Booted', 'Shutdown', 'Booting', 'Shutting Down', 'Creating'].includes(device?.state) ? device.state : 'unknown';
}
// Booted alone is insufficient: require bootstatus success AND the final state.
// Even on timeout, collect only a fixed state enum before preserving the failure.
export function waitUntilReady(device, command) {
  const state = step => deviceState(JSON.parse(command(step, ['simctl', 'list', 'devices', 'available', '-j'], NORMAL_TIMEOUT_MS).stdout), device.udid);
  const before = state('state-before'); ensure(before !== 'unknown');
  let failure; let after = 'unknown';
  try { command('boot-ready', ['simctl', 'bootstatus', device.udid, '-b'], BOOT_READY_TIMEOUT_MS); } catch (error) { failure = error; }
  try { after = state('state-after'); } catch (error) { failure ??= error; }
  if (failure) throw failure;
  ensure(after === 'Booted');
  return { stateBefore: before, stateAfter: after, bootStatusCompleted: true };
}
export function shutdownForCleanup(device, run = spawnSync) {
  const started = Date.now();
  const env = { ...process.env }; delete env.QA_REVIEWER_PASSWORD; delete env.MAESTRO_QA_REVIEWER_PASSWORD;
  const options = { encoding: 'utf8', timeout: NORMAL_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, env };
  const result = { family: device.family, shutdownSucceeded: false, finalState: 'unknown' };
  try { const command = run('xcrun', ['simctl', 'shutdown', device.udid], options); result.shutdownSucceeded = command.status === 0 && !command.error; } catch { /* No raw errors. */ }
  try {
    const state = run('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], options);
    if (state.status === 0 && !state.error) result.finalState = deviceState(JSON.parse(state.stdout), device.udid);
  } catch { /* A missing state is not shutdown proof. */ }
  return { ...result, elapsedMs: Math.max(0, Date.now() - started) };
}
export function cleanupPrepared(runnerTemp, run = spawnSync) {
  const output = join(runnerTemp, 'billmanager-ios-qa');
  const readiness = join(output, 'simulator-readiness.json'), selected = join(output, 'selected-devices.json');
  const devices = existsSync(readiness) ? JSON.parse(readFileSync(readiness, 'utf8')).devices : existsSync(selected) ? JSON.parse(readFileSync(selected, 'utf8')) : [];
  const results = devices.map(device => { ensure(['iphone', 'ipad'].includes(device.family)); return shutdownForCleanup(device, run); });
  const report = { passed: results.every(result => result.finalState === 'Shutdown'), devices: results };
  if (existsSync(output)) writeFileSync(join(output, 'simulator-cleanup.json'), JSON.stringify(report, null, 2));
  ensure(report.passed); return report;
}
export function prepareSimulators(runnerTemp, { run = spawnSync, now = Date.now } = {}) {
  const output = join(runnerTemp, 'billmanager-ios-qa');
  const report = { passed: false, stage: 'sdk', steps: [], devices: [], cleanup: [] };
  let firstFailure; const owned = [];
  const command = (step, executable, args, timeout = NORMAL_TIMEOUT_MS, device) => {
    report.stage = step;
    const start = now();
    const result = run(executable, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
    const entry = { step, elapsedMs: Math.max(0, now() - start), timeoutMs: timeout, success: result.status === 0 && !result.error };
    if (device && args.includes('list') && entry.success) {
      try { entry.state = deviceState(JSON.parse(result.stdout), device.udid); } catch { entry.state = 'unknown'; }
    }
    report.steps.push(entry);
    if (!entry.success) {
      firstFailure ??= { step, process: result.error?.code === 'ETIMEDOUT' ? 'timeout' : result.error ? 'launch_failed' : 'nonzero_exit',
        exitCode: Number.isInteger(result.status) ? result.status : null };
      ensure(false);
    }
    return result;
  };
  try {
    const sdk = command('sdk', 'xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']).stdout.trim();
    ensure(/^\d+\.\d+(?:\.\d+)?$/.test(sdk)); report.sdkVersion = sdk;
    const app = join(runnerTemp, 'billmanager-ios-derived/Build/Products/Release-iphonesimulator/BillManager.app');
    const archiveSdk = command('archive-sdk', '/usr/libexec/PlistBuddy', ['-c', 'Print :DTSDKName', join(app, 'Info.plist')]).stdout.trim();
    ensure(archiveSdk === `iphonesimulator${sdk}`); report.archiveSdkMatches = true;
    const inventory = JSON.parse(command('device-selection', 'xcrun', ['simctl', 'list', 'devices', 'available', '-j']).stdout);
    const devices = selectDevices(inventory, sdk); report.devices = devices;
    for (const device of devices) {
      owned.push(device);
      const xcrun = (step, args, timeout) => command(`${device.family}-${step}`, 'xcrun', args, timeout, device);
      waitUntilReady(device, xcrun);
      xcrun('locale-language', ['simctl', 'spawn', device.udid, 'defaults', 'write', 'NSGlobalDomain', 'AppleLanguages', '-array', 'en']);
      xcrun('locale-region', ['simctl', 'spawn', device.udid, 'defaults', 'write', 'NSGlobalDomain', 'AppleLocale', 'en_US']);
      xcrun('install', ['simctl', 'install', device.udid, app]);
      xcrun('shutdown', ['simctl', 'shutdown', device.udid]);
      const state = deviceState(JSON.parse(xcrun('shutdown-state', ['simctl', 'list', 'devices', 'available', '-j']).stdout), device.udid);
      ensure(state === 'Shutdown'); owned.pop();
    }
    // Publish prepared device IDs only after both passed readiness/install/shutdown.
    writeFileSync(join(output, 'selected-devices.json'), JSON.stringify(devices, null, 2));
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
    writeFileSync(join(output, 'manifest.json'), JSON.stringify({ ...manifest, captureDevices: devices, readinessSdkVersion: sdk }, null, 2));
    report.passed = true; report.stage = 'prepared';
  } catch {
    report.failure = firstFailure ?? { step: report.stage, process: 'boundary_failed', exitCode: null };
    report.stage = report.failure.step;
  } finally {
    for (const device of owned) {
      report.cleanup.push(shutdownForCleanup(device, run));
    }
    writeFileSync(join(output, 'simulator-readiness.json'), JSON.stringify(report, null, 2));
  }
  ensure(report.passed);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {
    ensure(!process.env.QA_REVIEWER_PASSWORD && !process.env.MAESTRO_QA_REVIEWER_PASSWORD);
    if (process.argv[2] === '--cleanup') cleanupPrepared(process.env.RUNNER_TEMP);
    else { ensure(process.argv.length === 2); prepareSimulators(process.env.RUNNER_TEMP); }
  } catch { console.error('Simulator preparation failed; inspect bounded simulator-readiness.json.'); process.exitCode = 1; }
}
