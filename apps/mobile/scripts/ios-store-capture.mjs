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

class PreflightFailure extends Error {
  constructor(diagnostic) { super('QA boundary assertion failed'); this.diagnostic = diagnostic; }
}

export async function verifyDemo(password, request = fetch) {
  let substage = 'login';
  const fail = (category, extra = {}) => { throw new PreflightFailure({ substage, category, ...extra }); };
  const check = (condition, category) => { if (!condition) fail(category); };
  const call = async (step, path, token, body) => {
    substage = step;
    let response;
    try {
      response = await request(API + path, { method: body ? 'POST' : 'GET', redirect: 'error',
        signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', 'X-Database': GROUP,
          ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { fail('transport'); }
    if (response.status !== 200) {
      fail('http_rejected', Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? { httpStatus: response.status } : {});
    }
    let result;
    try { result = await response.json(); } catch { fail('response_format'); }
    check(result?.success === true, 'api_contract'); return result.data;
  };
  try {
    const login = await call('login', '/auth/login', null, { username: 'store-review', password });
    check(typeof login?.access_token === 'string' && login.access_token.length > 0, 'login_contract');
    const token = login.access_token;
    const me = await call('me', '/me', token);
    check(me?.user?.id === 25 && me.user.username === 'store-review' && me.user.role === 'admin' && me.user.is_account_owner === true, 'account_boundary');
    check(Array.isArray(me.databases) && me.databases.length === 1 && me.databases[0].id === 23 && me.databases[0].name === GROUP, 'tenant_boundary');
    const billing = await call('billing', '/billing/status', token);
    check(billing?.effective_tier === 'pro' && billing.status === 'active' && billing.plan === 'review_demo' && billing.can_manage_subscription === false, 'entitlement_boundary');
    const bills = await call('bills', '/bills?include_archived=true', token);
    const approvedBillIds = new Set([71, 72, 73, 74]);
    check(Array.isArray(bills) && bills.length === 4 && bills.every(b => b && approvedBillIds.has(b.id) && NAMES.includes(b.name) && b.database_id === 23 && !b.is_shared)
      && new Set(bills.map(b => b.id)).size === 4 && new Set(bills.map(b => b.name)).size === 4, 'bill_boundary');
    const payments = await call('payments', '/payments', token);
    // Reusable reviewers may record additional synthetic payments. Retain the
    // reviewed history and strict tenant/bill boundaries; never require deleting data.
    check(Array.isArray(payments) && payments.length >= 2 && payments.length <= 100
      && payments.every(p => p && p.database_id === 23 && approvedBillIds.has(p.bill_id) && Number.isSafeInteger(p.id) && p.id > 0)
      && new Set(payments.map(p => p.id)).size === payments.length
      && [654, 655].every(id => payments.some(p => p.id === id)), 'payment_boundary');
    const settlements = await call('settlements', '/settlements', token);
    check(settlements && ['owed_to_me', 'i_owe', 'settled', 'people'].every(key => Array.isArray(settlements[key]) && settlements[key].length === 0), 'settlement_boundary');
    return { user: 25, database: 23, bills: 4, payments: payments.length };
  } catch (error) {
    if (error instanceof PreflightFailure) throw error;
    fail('contract');
  }
}

const absentAuth = [{ assertNotVisible: { id: 'auth-login-screen' } }, { assertNotVisible: { text: '^Password$' } }];
const wait = text => ({ extendedWaitUntil: { visible: { text }, timeout: 30000 } });
const route = path => ({ openLink: `billmanager://${path}` });
export const loginCommands = [
  { launchApp: { clearState: true } }, { extendedWaitUntil: { visible: { id: 'auth-login-screen' }, timeout: 30000 } },
  { tapOn: { text: '^Username$', index: 1 } }, { inputText: 'store-review' },
  { tapOn: { text: '^Password$', index: 1 } }, { inputText: '${MAESTRO_QA_REVIEWER_PASSWORD}' },
  { hideKeyboard: {} }, { tapOn: { text: '^Sign in$', index: 1 } },
  { extendedWaitUntil: { notVisible: { id: 'auth-login-screen' }, timeout: 30000 } },
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

// Maestro 2.12 commands.json schema: CommandDebugWrapper{command, metadata}.
// Only fixed enum labels and bounded numeric ordinals leave the private directory.
export function safeCommandFailure(directory, result) {
  const kinds = ['tapOnElement', 'assertConditionCommand', 'inputTextCommand', 'launchAppCommand',
    'applyConfigurationCommand', 'openLinkCommand', 'hideKeyboardCommand', 'takeScreenshotCommand'];
  const processOutcome = result.error?.code === 'ETIMEDOUT' ? 'timeout'
    : result.error?.code === 'ENOBUFS' ? 'output_limit' : result.error ? 'launch_failed' : 'nonzero_exit';
  const report = { process: processOutcome, exitCode: Number.isInteger(result.status) ? result.status : null };
  const pending = [];
  const walk = path => {
    for (const name of readdirSync(path)) {
      const file = join(path, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(file);
      else if (/^commands(?:-.*)?\.json$/.test(name) && stat.size <= 2_000_000) {
        const rows = JSON.parse(readFileSync(file, 'utf8'));
        if (!Array.isArray(rows) || rows.length > 1000) continue;
        rows.forEach((row, index) => {
          if (!['FAILED', 'RUNNING'].includes(row?.metadata?.status)) return;
          pending.push({ ordinal: index + 1, type: kinds.find(kind => row.command?.[kind] != null) ?? 'unknown', status: row.metadata.status });
        });
      }
    }
  };
  try { walk(directory); } catch { /* Missing/truncated debug output is not evidence. */ }
  const command = pending.find(row => row.status === 'FAILED') ?? pending.at(-1);
  if (command) report.command = command;
  const raw = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  report.category = /Element not found|No elements found/i.test(raw) ? 'element_not_found'
    : /Failed to parse|Unable to parse|Invalid YAML|Unrecognized field/i.test(raw) ? 'flow_parse'
      : /Failed to (?:start|connect to).*driver|Unable to connect to.*driver/i.test(raw) ? 'driver_unavailable' : 'unclassified';
  return report;
}

export async function runCapture(password, { runnerTemp = process.env.RUNNER_TEMP, run = spawnSync, request = fetch } = {}) {
  ensure(password.length >= 24 && password.length <= 256 && !/[\r\n\0]/.test(password));
  ensure(runnerTemp && resolve(runnerTemp) !== resolve(tmpdir(), 'billmanager-ios-qa'));
  const output = join(runnerTemp, 'billmanager-ios-qa');
  const promoted = join(output, 'store-screenshots');
  rmSync(promoted, { recursive: true, force: true });
  const privateDir = mkdtempSync(join(runnerTemp, 'billmanager-ios-private-')); // umask 077
  const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' }; delete env.QA_REVIEWER_PASSWORD;
  let failure;
  const execute = (command, args, secrets = false) => {
    const result = run(command, args, { cwd: privateDir, env: secrets ? { ...env, MAESTRO_QA_REVIEWER_PASSWORD: password } : env,
      encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    // Raw command output can include secrets. Never format it into thrown errors.
    writeFileSync(join(privateDir, 'last-command.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`, { mode: 0o600 });
    if (result.status !== 0 || result.error) { failure = safeCommandFailure(privateDir, result); ensure(false); }
  };
  const flow = (name, commands) => {
    const file = join(privateDir, `${name}.yaml`);
    writeFileSync(file, `appId: com.brdweb.billmanager\n---\n${JSON.stringify(commands, null, 2)}\n`, { mode: 0o600 }); return file;
  };
  let devices;
  const screenshots = []; let active; let stage = 'local-devices';
  try {
    devices = JSON.parse(readFileSync(join(output, 'selected-devices.json'), 'utf8'));
    stage = 'identity';
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
  } catch (error) {
    if (error instanceof PreflightFailure) failure = { preflight: error.diagnostic };
    rmSync(promoted, { recursive: true, force: true });
    writeFileSync(join(output, 'store-capture.json'), JSON.stringify({ passed: false, code: 'private_capture_failed', stage, ...(failure ? { failure } : {}) }));
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
