import { describe, expect, it } from 'vitest';
import { selectDevices } from './ios-qa-devices.mjs';
const d = (name, udid, isAvailable = true) => ({ name, udid, isAvailable });
const inventory = { devices: {
  'com.apple.CoreSimulator.SimRuntime.tvOS-26-0': [d('iPhone fake', 'tv')],
  'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [d('iPhone 16', 'phone-old'), d('iPhone 17', 'phone'), d('iPad mini (A17 Pro)', 'mini'), d('iPad Pro 13-inch (M4)', 'pad'), d('iPad Pro 13-inch (M5)', 'unavailable', false)],
} };
describe('native screenshot device selection', () => {
  it('requires both families and prefers the supported phone and largest tablet', () => {
    expect(selectDevices(inventory).map(x => [x.family, x.udid])).toEqual([['iphone', 'phone'], ['ipad', 'pad']]);
  });
  it('fails rather than claiming tablet coverage when no iPad is available', () => {
    expect(() => selectDevices({ devices: { 'iOS-26': [d('iPhone 17', 'p')] } })).toThrow(/iPad/);
  });
  it('rejects unavailable and non-iOS devices and has deterministic fallback', () => {
    expect(() => selectDevices({ devices: { 'tvOS-26': [d('iPhone 17', 'p'), d('iPad Pro', 't')] } })).toThrow(/iPhone/);
    const result = selectDevices({ devices: { 'iOS-26': [d('iPhone 16', 'p'), d('iPad Air 13-inch (M3)', 't')] } });
    expect(result.map(x => x.udid)).toEqual(['p', 't']);
  });
});
