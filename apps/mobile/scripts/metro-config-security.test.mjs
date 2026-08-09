import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const metroConfigPath = fileURLToPath(new URL('../metro.config.js', import.meta.url));
const auditConfigPath = fileURLToPath(new URL('../audit-ci.jsonc', import.meta.url));
const imageSizePath = require.resolve('image-size');

describe('Metro image parser security boundary', () => {
  it('disables every image-size parser covered by the unpatched advisories', () => {
    const imageSize = require(imageSizePath);
    const originalDisableTypes = imageSize.disableTypes;
    let disabledTypes;

    try {
      imageSize.disableTypes = (types) => {
        disabledTypes = [...types];
      };
      delete require.cache[require.resolve(metroConfigPath)];
      require(metroConfigPath);
    } finally {
      imageSize.disableTypes = originalDisableTypes;
      delete require.cache[require.resolve(metroConfigPath)];
    }

    expect(disabledTypes).toEqual(['heif', 'icns', 'jxl', 'jxl-stream']);
  });

  it(
    'preserves supported images and rejects ICNS before the vulnerable parser can loop',
    () => {
      const childScript = `
        require(process.argv[1]);
        const imageSize = require(process.argv[2]);
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        );
        const dimensions = imageSize(png);

        if (dimensions.width !== 1 || dimensions.height !== 1) {
          process.exit(4);
        }

        const input = Buffer.alloc(16);
        input.write('icns', 0, 'ascii');
        input.writeUInt32BE(16, 4);
        input.write('ic07', 8, 'ascii');
        input.writeUInt32BE(0, 12);

        try {
          imageSize(input);
          process.exit(2);
        } catch (error) {
          if (!String(error).includes('disabled file type: icns')) {
            process.exit(3);
          }
        }
      `;

      expect(() =>
        execFileSync(process.execPath, ['-e', childScript, metroConfigPath, imageSizePath], {
          stdio: 'pipe',
          timeout: 3_000,
        }),
      ).not.toThrow();
    },
    10_000,
  );
});

describe('mobile audit policy', () => {
  it('allows only the two mitigated advisories and keeps the exception temporary', () => {
    const config = JSON.parse(readFileSync(auditConfigPath, 'utf8'));
    const records = Object.assign({}, ...config.allowlist);

    expect(config.high).toBe(true);
    expect(Object.keys(records).sort()).toEqual(
      ['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr'].sort(),
    );
    expect(Object.values(records)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ active: true, expiry: '2026-09-09' }),
        expect.objectContaining({ active: true, expiry: '2026-09-09' }),
      ]),
    );
  });
});
