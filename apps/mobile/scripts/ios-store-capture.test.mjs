import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loginCommands, captureCommands, verifyDemo, safeScreenshots, runCapture } from './ios-store-capture.mjs';
const password = 'synthetic-fixture-only-not-a-credential';
const data = {
  '/auth/login': { access_token: 'fixture-token' },
  '/me': { user: { id: 25, username: 'store-review', role: 'admin', is_account_owner: true }, databases: [{ id: 23, name: 'reviewer-demo' }] },
  '/billing/status': { effective_tier: 'pro', status: 'active', plan: 'review_demo', can_manage_subscription: false },
  '/bills?include_archived=true': ['Salary', 'Rent', 'Utilities', 'Internet'].map((n, i) => ({ id: 71 + i, name: `DEMO ${n}`, database_id: 23 })),
  '/settlements': { owed_to_me: [], i_owe: [], settled: [], people: [] },
  '/payments': [{ bill_id: 72, database_id: 23 }, { bill_id: 73, database_id: 23 }],
};
const api = (values = data, calls = []) => async (url, options) => {
  calls.push({ url, options }); return { status: 200, json: async () => ({ success: true, data: values[url.replace('https://app.billmanager.app/api/v2', '')] }) };
};
const png = (width, height) => { const b = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(b); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); return b; };
describe('private native demo screenshot boundaries', () => {
  it('requires exact owner, sole database, manual Pro and synthetic records before UI', async () => {
    const calls = []; expect(await verifyDemo(password, api(data, calls))).toEqual({ user: 25, database: 23, bills: 4, payments: 2 });
    expect(calls.filter(c => c.options.method === 'POST').map(c => c.url)).toEqual(['https://app.billmanager.app/api/v2/auth/login']);
    expect(calls.every(c => c.options.redirect === 'error')).toBe(true);
    for (const path of ['/me', '/billing/status', '/bills?include_archived=true', '/payments']) {
      const bad = structuredClone(data);
      if (path === '/me') bad[path].databases.push({ id: 24, name: 'other' });
      if (path === '/billing/status') bad[path].can_manage_subscription = true;
      if (path.startsWith('/bills')) bad[path][0].name = 'Customer bill';
      if (path === '/payments') bad[path][0].database_id = 24;
      await expect(verifyDemo(password, api(bad))).rejects.toThrow('QA boundary');
    }
  });
  it('keeps password out of flow literals and uses only read-only navigation after login', () => {
    expect(JSON.stringify(loginCommands)).toContain('${MAESTRO_QA_REVIEWER_PASSWORD}');
    expect(loginCommands.some(c => c.takeScreenshot)).toBe(false);
    expect(captureCommands.some(c => c.inputText || c.tapOn)).toBe(false);
    expect(captureCommands.filter(c => c.takeScreenshot).map(c => c.takeScreenshot)).toEqual(['bills', 'payment-history', 'settlements', 'billing']);
    expect(captureCommands.filter(c => c.assertNotVisible?.id === 'auth-login-screen')).toHaveLength(4);
  });
  it('requires complete native-size PNG coverage; never resizes or accepts partial captures', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-png-test-'));
    try {
      writeFileSync(join(root, 'bills.png'), png(1206, 2622));
      expect(() => safeScreenshots(root, 'iphone')).toThrow();
      for (const name of ['payment-history', 'settlements', 'billing']) writeFileSync(join(root, `${name}.png`), png(1206, 2622));
      expect(safeScreenshots(root, 'iphone')).toHaveLength(4);
      expect(() => safeScreenshots(root, 'ipad')).toThrow();
    } finally { rmSync(root, { recursive: true }); }
  });
  it('suppresses secret-bearing failures, promotes no images and cleans private state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-driver-test-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out);
    writeFileSync(join(out, 'selected-devices.json'), JSON.stringify([{ family: 'iphone', udid: 'fixture' }, { family: 'ipad', udid: 'fixture2' }]));
    const calls = [];
    try {
      await expect(runCapture(password, { runnerTemp: root, request: api(), run: (command, args, options) => {
        calls.push({ command, args, options }); return { status: command === 'maestro' ? 1 : 0, stdout: password, stderr: 'Bearer fixture-token' };
      } })).rejects.toThrow('raw diagnostics withheld');
      expect(calls.some(c => c.command === 'maestro')).toBe(true);
      expect(calls.filter(c => c.command === 'maestro').every(c => c.options.env.MAESTRO_CLI_NO_ANALYTICS === 'true')).toBe(true);
      expect(calls.every(c => !JSON.stringify(c.args).includes(password))).toBe(true);
      expect(calls.filter(c => c.options.env?.MAESTRO_QA_REVIEWER_PASSWORD).map(c => c.command)).toEqual(['maestro']);
      expect(JSON.parse(readFileSync(join(out, 'store-capture.json'), 'utf8')).stage).toBe('iphone-login');
      expect(calls.every(c => !c.options.env || c.options.env.HOME === process.env.HOME)).toBe(true);
      expect(existsSync(join(out, 'store-screenshots'))).toBe(false);
      expect(readdirSync(root)).toEqual(['billmanager-ios-qa']);
    } finally { rmSync(root, { recursive: true }); }
  });
});

it('promotes eight allowlisted PNGs only after both complete; later-device failure removes all', async () => {
  for (const failSecond of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), 'qa-promotion-test-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out);
    writeFileSync(join(out, 'selected-devices.json'), JSON.stringify([{ family: 'iphone', udid: 'phone' }, { family: 'ipad', udid: 'pad' }]));
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({ sourceCommit: 'reviewed-fixture' }));
    let completed = 0;
    const run = (command, args) => {
      if (command === 'maestro' && args[3].endsWith('capture.yaml')) {
        expect(existsSync(join(out, 'store-screenshots'))).toBe(false);
        if (failSecond && completed === 1) return { status: 1, stdout: password };
        const dir = args[args.indexOf('--test-output-dir') + 1]; mkdirSync(dir, { recursive: true });
        for (const name of ['bills', 'payment-history', 'settlements', 'billing']) writeFileSync(join(dir, `${name}.png`), png(...(completed === 0 ? [1206, 2622] : [2064, 2752])));
        completed++;
      }
      return { status: 0 };
    };
    try {
      const promise = runCapture(password, { runnerTemp: root, request: api(), run });
      if (failSecond) { await expect(promise).rejects.toThrow(); expect(existsSync(join(out, 'store-screenshots'))).toBe(false); }
      else { await promise; expect(readdirSync(join(out, 'store-screenshots'))).toHaveLength(8); }
      expect(readdirSync(root)).toEqual(['billmanager-ios-qa']);
    } finally { rmSync(root, { recursive: true }); }
  }
});
