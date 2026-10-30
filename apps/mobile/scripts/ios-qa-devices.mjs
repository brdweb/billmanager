import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function selectDevices(inventory, sdkVersion) {
  if (sdkVersion !== undefined && !/^\d+\.\d+(?:\.\d+)?$/.test(sdkVersion)) throw new Error('Invalid Simulator SDK version');
  const matchingRuntime = sdkVersion === undefined ? undefined : `com.apple.CoreSimulator.SimRuntime.iOS-${sdkVersion.replaceAll('.', '-')}`;
  const devices = Object.entries(inventory.devices ?? {})
    .filter(([runtime]) => matchingRuntime ? runtime === matchingRuntime : runtime.includes('iOS-'))
    .flatMap(([runtime, items]) => items.filter(item => item.isAvailable).map(item => ({ ...item, runtime })));
  return ['iphone', 'ipad'].map(family => {
    const prefix = family === 'iphone' ? 'iPhone' : 'iPad';
    const candidates = devices.filter(item => item.name.startsWith(prefix));
    const preferred = family === 'iphone' ? candidates.find(item => item.name === 'iPhone 17')
      : candidates.find(item => /iPad Pro 13-inch/.test(item.name)) ?? candidates.find(item => /13-inch|12\.9-inch/.test(item.name));
    const device = preferred ?? candidates[0];
    if (!device) throw new Error(`No installed ${prefix} Simulator runtime available`);
    return { family, name: device.name, udid: device.udid, runtime: device.runtime };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const devices = selectDevices(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  process.stdout.write(`${JSON.stringify(devices, null, 2)}\n`);
}
