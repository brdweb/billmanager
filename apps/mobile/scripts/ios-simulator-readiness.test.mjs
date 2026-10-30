import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BOOT_READY_TIMEOUT_MS, prepareSimulators, waitUntilReady } from './ios-simulator-readiness.mjs';
import { selectDevices } from './ios-qa-devices.mjs';
const sdkRuntime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const makeInventory = states => ({ devices: {
  'com.apple.CoreSimulator.SimRuntime.iOS-26-4': [{ name: 'iPhone 17', udid: 'old-phone', isAvailable: true, state: 'Shutdown' }],
  [sdkRuntime]: [{ name: 'iPhone 17', udid: 'phone', isAvailable: true, state: states.phone }, { name: 'iPad Pro 13-inch (M5)', udid: 'pad', isAvailable: true, state: states.pad }],
} });
it('selects the active SDK runtime rather than the first older device, failing closed if absent', () => {
  expect(selectDevices(makeInventory({ phone: 'Shutdown', pad: 'Shutdown' }), '26.5').map(d => d.udid)).toEqual(['phone', 'pad']);
  expect(() => selectDevices(makeInventory({}), '26.6')).toThrow();
});
it('does not treat Booted alone as readiness and preserves boot timeout while checking state afterward', () => {
  const calls = [];
  expect(() => waitUntilReady({ udid: 'phone' }, (step, args, timeout) => {
    calls.push({ step, timeout });
    if (step === 'boot-ready') throw new Error('fixture timeout');
    return { stdout: JSON.stringify(makeInventory({ phone: 'Booted', pad: 'Shutdown' })) };
  })).toThrow('fixture timeout');
  expect(calls.map(c => c.step)).toEqual(['state-before', 'boot-ready', 'state-after']);
  expect(calls.find(c => c.step === 'boot-ready').timeout).toBe(600000);
});
for (const failureStep of [undefined, 'boot-ready', 'install']) {
  it(`serially prepares/shuts down both devices, with bounded safe evidence (${failureStep ?? 'success'})`, () => {
    const root = mkdtempSync(join(tmpdir(), 'ios-ready-fixture-')); const output = join(root, 'billmanager-ios-qa'); mkdirSync(output);
    writeFileSync(join(output, 'manifest.json'), JSON.stringify({ sourceCommit: 'fixture-source' }));
    const states = { phone: 'Shutdown', pad: 'Shutdown' }; const calls = []; let clock = 0;
    const run = (executable, args, options) => {
      calls.push({ executable, args, timeout: options.timeout });
      if (args.includes('--show-sdk-version')) return { status: 0, stdout: '26.5\n' };
      if (executable.includes('PlistBuddy')) return { status: 0, stdout: 'iphonesimulator26.5\n' };
      if (args[1] === 'list') return { status: 0, stdout: JSON.stringify(makeInventory(states)) };
      if (args[1] === 'bootstatus') {
        expect(Object.values(states).filter(s => s === 'Booted')).toHaveLength(0);
        states[args[2]] = 'Booted';
        if (failureStep === 'boot-ready') return { status: null, error: { code: 'ETIMEDOUT', message: 'private-fixture-value' } };
      }
      if (args[1] === 'install' && failureStep === 'install') return { status: null, error: { code: 'ETIMEDOUT', message: 'private-fixture-value' } };
      if (args[1] === 'shutdown') states[args[2]] = 'Shutdown';
      return { status: 0, stdout: 'private-fixture-value' };
    };
    try {
      const work = () => prepareSimulators(root, { run, now: () => clock += 11 });
      if (failureStep) expect(work).toThrow(); else expect(work().passed).toBe(true);
      const report = JSON.parse(readFileSync(join(output, 'simulator-readiness.json'), 'utf8'));
      expect(Object.values(states)).toEqual(['Shutdown', 'Shutdown']);
      expect(JSON.stringify(report)).not.toContain('private-fixture-value');
      expect(calls.filter(c => c.args[1] === 'bootstatus').every(c => c.timeout === BOOT_READY_TIMEOUT_MS)).toBe(true);
      expect(calls.filter(c => c.args[1] !== 'bootstatus').every(c => c.timeout === 180000)).toBe(true);
      if (failureStep) expect(report).toMatchObject({ passed: false, stage: `iphone-${failureStep}`, failure: { process: 'timeout', exitCode: null } });
      else expect(report.steps.filter(s => s.step.endsWith('shutdown-state')).map(s => s.state)).toEqual(['Shutdown', 'Shutdown']);
    } finally { rmSync(root, { recursive: true }); }
  });
}
it('accepts a ready warm boot but still asks bootstatus rather than trusting Booted', () => {
  const steps = [];
  expect(waitUntilReady({ udid: 'phone' }, (step, args, timeout) => {
    steps.push(step);
    return { status: 0, stdout: JSON.stringify(makeInventory({ phone: 'Booted', pad: 'Shutdown' })) };
  })).toEqual({ stateBefore: 'Booted', stateAfter: 'Booted', bootStatusCompleted: true });
  expect(steps).toEqual(['state-before', 'boot-ready', 'state-after']);
});
