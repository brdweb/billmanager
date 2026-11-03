import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { simulatedAppIdentifier } from './ios-simulated-entitlements.mjs';

// Representative __TEXT,__entitlements bytes as `segedit -extract` writes them: Xcode's
// *-Simulated.xcent XML plist, zero-padded to the section alignment.
const xcent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>application-identifier</key>
\t<string>FAKETEAMID.com.brdweb.billmanager</string>
\t<key>com.apple.security.application-groups</key>
\t<array>
\t\t<string>group.com.brdweb.billmanager</string>
\t</array>
</dict>
</plist>
`;
const run = bytes => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-ents-'));
  try {
    writeFileSync(join(dir, 'section'), bytes);
    return spawnSync(process.execPath, [new URL('./ios-simulated-entitlements.mjs', import.meta.url).pathname, join(dir, 'section')], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true }); }
};

describe('Simulator simulated-entitlements check', () => {
  it('reads the application-identifier from the extracted, zero-padded section', () => {
    expect(simulatedAppIdentifier(Buffer.concat([Buffer.from(xcent), Buffer.alloc(13)]))).toBe('FAKETEAMID.com.brdweb.billmanager');
    expect(run(Buffer.concat([Buffer.from(xcent), Buffer.alloc(13)])).status).toBe(0);
  });
  it('fails closed on missing keys, empty values, other bundles, hex dumps and binary plists', () => {
    const cases = [
      xcent.replace(/\t<key>application-identifier<\/key>\n\t<string>[^<]+<\/string>\n/, ''),
      xcent.replace('FAKETEAMID.com.brdweb.billmanager', ''),
      xcent.replace('com.brdweb.billmanager</string>\n\t<key>com', 'com.example.other</string>\n\t<key>com'),
      // What `otool -s __TEXT __entitlements -V` prints: 16-byte rows, never the whole key contiguously.
      '0000000100a3c000\t3c 3f 78 6d 6c 20 76 65 72 73 69 6f 6e 3d 22 31  |<?xml version="1|\n0000000100a3c0f0\t61 70 70 6c 69 63 61 74 69 6f 6e 2d 69 64 65 6e  |application-iden|',
      'bplist00Ñ\u0001\u0002_\u0010\u0016application-identifier',
    ];
    for (const text of cases) expect(run(Buffer.from(text)).status).toBe(1);
    expect(run(Buffer.alloc(0)).status).toBe(1);
  });
});
