// QA-only native UI driver. No credential, token, raw diagnostic or failure image is published.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const GROUP = 'reviewer-demo';
const NAMES = ['DEMO Salary', 'DEMO Rent', 'DEMO Utilities', 'DEMO Internet'];
const API = 'https://app.billmanager.app/api/v2';
const ensure = condition => { if (!condition) throw new Error('QA boundary assertion failed'); };

export async function verifyDemo(password, request = fetch) {
  const call = async (path, token, body) => {
    const response = await request(API + path, { method: body ? 'POST' : 'GET', redirect: 'error',
      signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'X-Database': GROUP,
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    ensure(response.status === 200);
    const result = await response.json(); ensure(result.success === true); return result.data;
  };
  const login = await call('/auth/login', null, { username: 'store-review', password });
  ensure(typeof login.access_token === 'string' && login.access_token.length > 0);
  const token = login.access_token;
  const me = await call('/me', token);
  ensure(me.user?.id === 25 && me.user.username === 'store-review' && me.user.role === 'admin' && me.user.is_account_owner === true);
  ensure(me.databases?.length === 1 && me.databases[0].id === 23 && me.databases[0].name === GROUP);
  const billing = await call('/billing/status', token);
  ensure(billing.effective_tier === 'pro' && billing.status === 'active' && billing.plan === 'review_demo' && billing.can_manage_subscription === false);
  const bills = await call('/bills?include_archived=true', token);
  ensure(Array.isArray(bills) && bills.length === 4 && new Set(bills.map(b => b.name)).size === 4);
  ensure(bills.every(b => NAMES.includes(b.name) && b.database_id === 23 && !b.is_shared));
  const payments = await call('/payments', token);
  ensure(Array.isArray(payments) && payments.length === 2 && payments.every(p => p.database_id === 23 && bills.some(b => b.id === p.bill_id)));
  const settlements = await call('/settlements', token);
  ensure(['owed_to_me', 'i_owe', 'settled', 'people'].every(key => Array.isArray(settlements[key]) && settlements[key].length === 0));
  return { user: 25, database: 23, bills: 4, payments: 2 };
}

const absentAuth = [{ assertNotVisible: { id: 'auth-login-screen' } }, { assertNotVisible: { text: '^Password$' } }];
const wait = text => ({ extendedWaitUntil: { visible: { text }, timeout: 30000 } });
const route = path => ({ openLink: `billmanager://${path}` });
export const loginCommands = [
  { launchApp: { clearState: true } }, { extendedWaitUntil: { visible: { id: 'auth-login-screen' }, timeout: 30000 } },
  { tapOn: { text: '^Username$', index: 1 } }, { inputText: 'store-review' },
  { tapOn: { text: '^Password$', index: 1 } }, { inputText: '${MAESTRO_QA_REVIEWER_PASSWORD}' },
  { hideKeyboard: {} }, { tapOn: { text: '^Sign in$', index: 1 } },
  route('bills'), wait('.*DEMO Rent.*'), ...absentAuth,
];
export const captureCommands = [
  route('bills'), ...NAMES.map(name => wait(`.*${name}.*`)), ...absentAuth, { takeScreenshot: 'bills' },
  route('payments'), wait('Payment history'), wait('.*DEMO Rent.*'), wait('.*DEMO Utilities.*'), ...absentAuth, { takeScreenshot: 'payment-history' },
  route('settlements'), wait('Everyone is settled up'), ...absentAuth, { takeScreenshot: 'settlements' },
  route('settings/billing'), wait('Plan and billing'), wait('.*Pro.*'),
  { assertNotVisible: { text: 'Open billing portal' } }, ...absentAuth, { takeScreenshot: 'billing' },
];
const EXPECTED = ['bills.png', 'payment-history.png', 'settlements.png', 'billing.png'];
export function safeScreenshots(directory, family) {
  const found = [];
  const walk = path => {
    for (const name of readdirSync(path)) {
      const file = join(path, name); const stat = lstatSync(file); ensure(!stat.isSymbolicLink());
      if (stat.isDirectory()) walk(file);
      else if (EXPECTED.includes(name)) found.push({ name, file });
    }
  };
  walk(directory); ensure(found.length === 4 && new Set(found.map(f => f.name)).size === 4);
  return found.map(({ name, file }) => {
    const bytes = readFileSync(file); ensure(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    ensure(family === 'iphone' ? width === 1206 && height === 2622 : (width === 2048 && height === 2732) || (width === 2064 && height === 2752));
    return { name, file, width, height, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
}

export async function runCapture(password, { runnerTemp = process.env.RUNNER_TEMP, run = spawnSync, request = fetch } = {}) {
  ensure(password.length >= 24 && password.length <= 256 && !/[\r\n\0]/.test(password));
  ensure(runnerTemp && resolve(runnerTemp) !== resolve(tmpdir(), 'billmanager-ios-qa'));
  const output = join(runnerTemp, 'billmanager-ios-qa');
  const promoted = join(output, 'store-screenshots');
  rmSync(promoted, { recursive: true, force: true });
  const privateDir = mkdtempSync(join(runnerTemp, 'billmanager-ios-private-')); // umask 077
  const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' }; delete env.QA_REVIEWER_PASSWORD;
  const execute = (command, args, secrets = false) => {
    const result = run(command, args, { cwd: privateDir, env: secrets ? { ...env, MAESTRO_QA_REVIEWER_PASSWORD: password } : env,
      encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    // Raw command output can include secrets. Never format it into thrown errors.
    writeFileSync(join(privateDir, 'last-command.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`, { mode: 0o600 });
    ensure(result.status === 0 && !result.error);
  };
  const flow = (name, commands) => {
    const file = join(privateDir, `${name}.yaml`);
    writeFileSync(file, `appId: com.brdweb.billmanager\n---\n${JSON.stringify(commands, null, 2)}\n`, { mode: 0o600 }); return file;
  };
  let devices;
  const screenshots = []; let active; let stage = 'identity';
  try {
    devices = JSON.parse(readFileSync(join(output, 'selected-devices.json'), 'utf8'));
    const identity = await verifyDemo(password, request);
    const login = flow('login', loginCommands), capture = flow('capture', captureCommands);
    for (const device of devices) {
      ensure(['iphone', 'ipad'].includes(device.family)); active = device.udid; stage = `${device.family}-boot-install`;
      execute('xcrun', ['simctl', 'boot', active]); execute('xcrun', ['simctl', 'bootstatus', active, '-b']);
      execute('xcrun', ['simctl', 'spawn', active, 'defaults', 'write', 'NSGlobalDomain', 'AppleLanguages', '-array', 'en']);
      execute('xcrun', ['simctl', 'spawn', active, 'defaults', 'write', 'NSGlobalDomain', 'AppleLocale', 'en_US']);
      execute('xcrun', ['simctl', 'install', active, join(runnerTemp, 'billmanager-ios-derived/Build/Products/Release-iphonesimulator/BillManager.app')]);
      const deviceDir = join(privateDir, device.family); mkdirSync(deviceDir);
      stage = `${device.family}-login`;
      execute('maestro', ['--device', active, 'test', login, '--test-output-dir', join(deviceDir, 'login'), '--debug-output', join(deviceDir, 'login-debug')], true);
      stage = `${device.family}-read-only-capture`;
      execute('maestro', ['--device', active, 'test', capture, '--test-output-dir', join(deviceDir, 'capture'), '--debug-output', join(deviceDir, 'capture-debug')]);
      stage = `${device.family}-png-validation`;
      screenshots.push(...safeScreenshots(join(deviceDir, 'capture'), device.family).map(s => ({ ...s, family: device.family })));
      execute('xcrun', ['simctl', 'shutdown', active]); active = undefined;
    }
    ensure(devices.length === 2 && new Set(devices.map(d => d.family)).size === 2 && screenshots.length === 8);
    stage = 'promotion';
    // Nothing is promoted until BOTH devices completed every assertion. No login/failure captures.
    mkdirSync(promoted);
    for (const s of screenshots) copyFileSync(s.file, join(promoted, `${s.family}-${s.name}`));
    const manifest = { passed: true, identity, devices, screenshots: screenshots.map(({ file, ...s }) => s),
      sourceCommit: JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')).sourceCommit,
      acceptance: 'native Simulator read-only synthetic demo; not physical-device or signed-device acceptance' };
    const text = JSON.stringify(manifest, null, 2); ensure(!text.includes(password) && !/Bearer |access_token|refresh_token|eyJ[A-Za-z0-9_-]+\./.test(text));
    writeFileSync(join(output, 'store-capture.json'), text);
  } catch {
    rmSync(promoted, { recursive: true, force: true });
    writeFileSync(join(output, 'store-capture.json'), JSON.stringify({ passed: false, code: 'private_capture_failed', stage }));
    throw new Error('Private screenshot capture failed; raw diagnostics withheld');
  } finally {
    if (active) run('xcrun', ['simctl', 'shutdown', active], { stdio: 'ignore', timeout: 30000 });
    rmSync(privateDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const password = readFileSync(0, 'utf8'); delete process.env.QA_REVIEWER_PASSWORD;
  runCapture(password).catch(() => { console.error('Private screenshot capture failed; no raw diagnostics published.'); process.exitCode = 1; });
}
