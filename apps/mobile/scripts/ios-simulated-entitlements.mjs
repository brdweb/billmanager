// Checks the entitlements Xcode links into __TEXT,__entitlements for "Sign to Run Locally"
// Simulator builds. The section is the raw XML plist from *-Simulated.xcent; the Simulator
// keychain needs a non-empty application-identifier from it (errSecMissingEntitlement otherwise).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function simulatedAppIdentifier(bytes) {
  const text = Buffer.from(bytes).toString('utf8').replace(/\0+$/, '');
  if (!text.trimStart().startsWith('<?xml') || !text.includes('<plist')) return null;
  const match = text.match(/<key>\s*application-identifier\s*<\/key>\s*<string>\s*([^<\s][^<]*?)\s*<\/string>/);
  return match ? match[1] : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const identifier = simulatedAppIdentifier(readFileSync(process.argv[2]));
  if (!identifier || !identifier.endsWith('.com.brdweb.billmanager')) {
    console.error('Simulated entitlements lack an application-identifier for com.brdweb.billmanager');
    process.exit(1);
  }
  console.log('Simulated application-identifier present');
}
