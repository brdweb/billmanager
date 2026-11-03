// QA-only native UI driver. No credential, token, raw diagnostic or failure image is published.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { waitUntilReady, deviceState, shutdownForCleanup } from './ios-simulator-readiness.mjs';

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
// iOS 26 asks "Open in “BillManager”?" for every simctl custom-scheme link and offers
// to save the reviewer password after sign-in. Both are system prompts over the app;
// tapping only their exact confirm/decline labels keeps the app itself read-only.
export const CONFIRM_OPEN = { tapOn: { text: '^Open$', optional: true } };
export const DECLINE_SAVE_PASSWORD = { tapOn: { text: '^Not Now$', optional: true } };
const route = path => [{ openLink: `billmanager://${path}` }, CONFIRM_OPEN];
// Each login step is a labelled runFlow so a failure can be attributed to a fixed
// step name without publishing raw output. Selectors exist in the shipped build 16
// source (81a9e78): the field Text label precedes the accessible TextInput, and
// the "Sign in" header precedes the button. hideKeyboard is unreliable on iOS, so
// Return on the password field submits through onSubmitEditing and blurs it, with
// a guarded tap on an enabled Sign in button as fallback.
export const LOGIN_STEPS = ['launch', 'username', 'password', 'submit', 'post-login', 'deep-link'];
const STEP_LABEL = 'qa-login-step-';
const step = (name, commands) => ({ runFlow: { label: STEP_LABEL + name, commands } });
const SIGN_IN = { text: '^Sign in$', index: 1, enabled: true };
export const loginCommands = [
  step('launch', [{ launchApp: { clearState: true } }, { extendedWaitUntil: { visible: { id: 'auth-login-screen' }, timeout: 60000 } },
    { assertVisible: { text: '^Username$' } }, { assertVisible: { text: '^Password$' } }]),
  step('username', [{ tapOn: { text: '^Username$', index: 1 } }, { inputText: 'store-review' }]),
  step('password', [{ tapOn: { text: '^Password$', index: 1 } }, { inputText: '${MAESTRO_QA_REVIEWER_PASSWORD}' }]),
  // Return submits through onSubmitEditing. If an enabled Sign in button is still shown
  // (Return did not submit), tap it once as a guarded fallback. An enabled button
  // disappears once submission starts (busy) or the screen leaves.
  step('submit', [{ pressKey: 'Enter' }, { runFlow: { when: { visible: SIGN_IN }, commands: [{ tapOn: { text: '^Sign in$', index: 1 } }] } },
    { extendedWaitUntil: { notVisible: SIGN_IN, timeout: 15000 } }]),
  step('post-login', [{ extendedWaitUntil: { notVisible: { id: 'auth-login-screen' }, timeout: 60000 } }]),
  step('deep-link', [...route('bills'), DECLINE_SAVE_PASSWORD, { extendedWaitUntil: { visible: { text: '.*DEMO Rent.*' }, timeout: 60000 } }, ...absentAuth]),
];
// Each screen starts from a fresh launch of the signed-in app (clearState: false keeps
// the keychain session) and opens its own link, so no capture depends on a tab-to-tab
// transition. Run 41676812680 crashed inside iOS 26 UINavigationBar accessibility
// (swift_reflectionMirror, KERN_INVALID_ADDRESS) while XCUITest read the hierarchy
// mid-transition; a bounded retry relaunches the app if that platform crash recurs.
export const CAPTURE_RETRIES = 2;
// A link opened before the relaunched app has mounted its navigator is dropped (run
// 41713365017 stayed on Home), so each screen waits for the signed-in Home title first.
export const APP_READY = { extendedWaitUntil: { visible: { text: '^Overview$' }, timeout: 60000 } };
const screen = (path, checks, name) => ({ retry: { maxRetries: CAPTURE_RETRIES, commands: [
  { launchApp: { clearState: false } }, APP_READY, ...route(path), ...checks, ...absentAuth, { takeScreenshot: name },
] } });
export const captureCommands = [
  screen('bills', NAMES.map(name => wait(`.*${name}.*`)), 'bills'),
  // The payment rows sit below the summary and filters on a phone, so only the always
  // visible header and summary are asserted; verifyDemo already pins the payment data.
  screen('payments', [wait('Payment history'), wait('Net total')], 'payment-history'),
  screen('settlements', [wait('Everyone is settled up')], 'settlements'),
  screen('settings/billing', [wait('Plan and billing'), wait('.*Pro.*'), { assertNotVisible: { text: 'Open billing portal' } }], 'billing'),
];
// Driver start-up plus every bounded in-flow wait, with headroom.
export const LOGIN_TIMEOUT_MS = 540000, CAPTURE_TIMEOUT_MS = 900000;
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
    'applyConfigurationCommand', 'openLinkCommand', 'hideKeyboardCommand', 'takeScreenshotCommand',
    'pressKeyCommand', 'runFlowCommand', 'retryCommand'];
  const processOutcome = result.error?.code === 'ETIMEDOUT' ? 'timeout'
    : result.error?.code === 'ENOBUFS' ? 'output_limit' : result.error ? 'launch_failed' : 'nonzero_exit';
  const report = { process: processOutcome, exitCode: Number.isInteger(result.status) ? result.status : null };
  const pending = [], steps = [];
  const stepOf = label => LOGIN_STEPS.find(name => label === STEP_LABEL + name);
  const walk = path => {
    for (const name of readdirSync(path)) {
      const file = join(path, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(file);
      else if (/^commands(?:-.*)?\.json$/.test(name) && stat.size <= 2_000_000) {
        let rows;
        try { rows = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
        if (!Array.isArray(rows) || rows.length > 1000) continue;
        rows.forEach((row, index) => {
          if (!['FAILED', 'RUNNING'].includes(row?.metadata?.status)) return;
          const type = kinds.find(kind => row.command?.[kind] != null) ?? 'unknown';
          pending.push({ ordinal: index + 1, type, status: row.metadata.status });
          const labelled = type === 'runFlowCommand' ? stepOf(row.command.runFlowCommand.label) : undefined;
          if (labelled) steps.push(labelled);
        });
      }
    }
  };
  try { walk(directory); } catch { /* Missing/truncated debug output is not evidence. */ }
  // Nested commands follow their runFlow parent; report the innermost failed command.
  const failed = pending.filter(row => row.status === 'FAILED');
  const command = failed.findLast(row => !['runFlowCommand', 'retryCommand'].includes(row.type)) ?? failed.at(-1) ?? pending.at(-1);
  if (command) report.command = command;
  const raw = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  report.category = /Element not found|No elements found|No visible element found/i.test(raw) ? 'element_not_found'
    : /Assertion is false/i.test(raw) ? 'assertion_false'
      : /Couldn't hide the keyboard/i.test(raw) ? 'keyboard_not_hidden'
        : /Unable to launch app/i.test(raw) ? 'app_launch_failed'
          : /Failed to parse|Unable to parse|Invalid YAML|Unrecognized field/i.test(raw) ? 'flow_parse'
            : /Failed to (?:start|connect to).*driver|Unable to connect to.*driver/i.test(raw) ? 'driver_unavailable' : 'unclassified';
  // Plain console output prints each labelled step when it starts; the latest one
  // started is the step that was running. Only fixed step names are published.
  const started = [...raw.matchAll(/qa-login-step-([a-z-]+?)(?![a-z-])/g)].map(match => LOGIN_STEPS.indexOf(match[1])).filter(i => i >= 0);
  if (steps.length) Object.assign(report, { step: steps.at(-1), stepSource: 'command_report' });
  else if (started.length) Object.assign(report, { step: LOGIN_STEPS[Math.max(...started)], stepSource: 'console' });
  return report;
}

// On failure, raw Maestro output (which can contain the reviewer password) is sealed with
// age to an operator-held public key and only the ciphertext leaves the runner. Nothing
// is sealed without a well-formed recipient, and no plaintext archive outlives this call.
const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;
export function sealPrivateDiagnostics(privateDir, output, recipient, run = spawnSync) {
  if (!AGE_RECIPIENT.test(recipient ?? '')) return { sealed: false, reason: 'no_recipient' };
  if (!existsSync(privateDir) || readdirSync(privateDir).length === 0) return { sealed: false, reason: 'nothing_to_seal' };
  // Fixed system tar and a minimal environment: no PATH-shadowed tar and no inherited credentials.
  const options = { timeout: 120000, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } };
  const staging = mkdtempSync(join(resolve(output, '..'), 'billmanager-ios-seal-'));
  const archive = join(staging, 'diagnostics.tar.gz'), sealed = join(output, 'sealed-capture-failure.tar.age');
  try {
    const tar = run('/usr/bin/tar', ['-czf', archive, '-C', privateDir, '.'], options);
    if (tar.status !== 0 || tar.error) return { sealed: false, reason: 'archive_failed' };
    const age = run('age', ['-r', recipient, '-o', sealed, archive], options);
    if (age.status !== 0 || age.error) { rmSync(sealed, { force: true }); return { sealed: false, reason: 'encrypt_failed' }; }
    return { sealed: true };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

const persistCleanup = (path, cleanup) => writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), cleanup }));
export async function runCapture(password, { runnerTemp = process.env.RUNNER_TEMP, run = spawnSync, request = fetch, recordCleanup = persistCleanup,
  diagnosticsRecipient = process.env.QA_DIAGNOSTICS_AGE_RECIPIENT } = {}) {
  ensure(password.length >= 24 && password.length <= 256 && !/[\r\n\0]/.test(password));
  ensure(runnerTemp && resolve(runnerTemp) !== resolve(tmpdir(), 'billmanager-ios-qa'));
  const output = join(runnerTemp, 'billmanager-ios-qa');
  const promoted = join(output, 'store-screenshots');
  rmSync(promoted, { recursive: true, force: true });
  const privateDir = mkdtempSync(join(runnerTemp, 'billmanager-ios-private-')); // umask 077
  // A freshly prepared Simulator can need longer than Maestro's default to start its XCTest driver.
  const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true', MAESTRO_DRIVER_STARTUP_TIMEOUT: '300000' };
  delete env.QA_REVIEWER_PASSWORD; delete env.QA_DIAGNOSTICS_AGE_RECIPIENT;
  let failure; const commandTimings = [];
  const execute = (command, args, secrets = false, timeout = 180000) => {
    const started = Date.now();
    const result = run(command, args, { cwd: privateDir, env: secrets ? { ...env, MAESTRO_QA_REVIEWER_PASSWORD: password } : env,
      encoding: 'utf8', timeout, ...(command === 'xcrun' ? { killSignal: 'SIGKILL' } : {}), maxBuffer: 16 * 1024 * 1024 });
    // Raw command output can include secrets. Never format it into thrown errors.
    writeFileSync(join(privateDir, 'last-command.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`, { mode: 0o600 });
    const entry = { step: stage, elapsedMs: Math.max(0, Date.now() - started), timeoutMs: timeout, success: result.status === 0 && !result.error };
    if (command === 'xcrun' && args[0] === 'simctl' && args[1] === 'list' && entry.success) {
      try { entry.state = deviceState(JSON.parse(result.stdout), active); } catch { entry.state = 'unknown'; }
    }
    commandTimings.push(entry);
    if (!entry.success) { failure ??= { ...safeCommandFailure(privateDir, result), stage }; ensure(false); }
    return result;
  };
  const flow = (name, commands) => {
    const file = join(privateDir, `${name}.yaml`);
    writeFileSync(file, `appId: com.brdweb.billmanager\n---\n${JSON.stringify(commands, null, 2)}\n`, { mode: 0o600 }); return file;
  };
  let devices;
  const screenshots = []; let active; let stage = 'local-devices';
  try {
    devices = JSON.parse(readFileSync(join(output, 'selected-devices.json'), 'utf8'));
    const prepared = JSON.parse(readFileSync(join(output, 'simulator-readiness.json'), 'utf8'));
    ensure(prepared.passed === true && JSON.stringify(prepared.devices) === JSON.stringify(devices));
    ensure(devices.length === 2 && new Set(devices.map(device => device.family)).size === 2);
    stage = 'identity';
    const identity = await verifyDemo(password, request);
    const login = flow('login', loginCommands), capture = flow('capture', captureCommands);
    for (const device of devices) {
      ensure(['iphone', 'ipad'].includes(device.family)); active = device.udid;
      waitUntilReady(device, (step, args, timeout) => {
        stage = `${device.family}-${step}`;
        return execute('xcrun', args, false, timeout);
      });
      const deviceDir = join(privateDir, device.family); mkdirSync(deviceDir);
      stage = `${device.family}-login`;
      execute('maestro', ['--device', active, 'test', login, '--test-output-dir', join(deviceDir, 'login'), '--debug-output', join(deviceDir, 'login-debug')], true, LOGIN_TIMEOUT_MS);
      stage = `${device.family}-read-only-capture`;
      execute('maestro', ['--device', active, 'test', capture, '--test-output-dir', join(deviceDir, 'capture'), '--debug-output', join(deviceDir, 'capture-debug')], false, CAPTURE_TIMEOUT_MS);
      stage = `${device.family}-png-validation`;
      screenshots.push(...safeScreenshots(join(deviceDir, 'capture'), device.family).map(s => ({ ...s, family: device.family })));
      stage = `${device.family}-shutdown`;
      execute('xcrun', ['simctl', 'shutdown', active]); active = undefined;
    }
    ensure(devices.length === 2 && new Set(devices.map(d => d.family)).size === 2 && screenshots.length === 8);
    stage = 'promotion';
    // Nothing is promoted until BOTH devices completed every assertion. No login/failure captures.
    mkdirSync(promoted);
    for (const s of screenshots) copyFileSync(s.file, join(promoted, `${s.family}-${s.name}`));
    const manifest = { passed: true, identity, devices, commandTimings, screenshots: screenshots.map(({ file, ...s }) => s),
      sourceCommit: JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')).sourceCommit,
      acceptance: 'native Simulator read-only synthetic demo; not physical-device or signed-device acceptance' };
    const text = JSON.stringify(manifest, null, 2); ensure(!text.includes(password) && !/Bearer |access_token|refresh_token|eyJ[A-Za-z0-9_-]+\./.test(text));
    writeFileSync(join(output, 'store-capture.json'), text);
  } catch (error) {
    if (error instanceof PreflightFailure) failure = { preflight: error.diagnostic };
    if (failure?.stage) stage = failure.stage;
    rmSync(promoted, { recursive: true, force: true });
    let diagnostics;
    try { diagnostics = sealPrivateDiagnostics(privateDir, output, diagnosticsRecipient, run); } catch { diagnostics = { sealed: false, reason: 'seal_error' }; }
    writeFileSync(join(output, 'store-capture.json'), JSON.stringify({ passed: false, code: 'private_capture_failed', stage, commandTimings, ...(failure ? { failure } : {}), diagnostics }));
    throw new Error('Private screenshot capture failed; raw diagnostics withheld');
  } finally {
    try {
      if (active) {
        const cleanup = shutdownForCleanup(devices.find(device => device.udid === active), run);
        recordCleanup(join(output, 'store-capture.json'), cleanup);
      }
    } catch { /* Optional cleanup evidence must not replace the original safe failure. */ }
    finally { rmSync(privateDir, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const password = readFileSync(0, 'utf8'); delete process.env.QA_REVIEWER_PASSWORD;
  runCapture(password).catch(() => { console.error('Private screenshot capture failed; no raw diagnostics published.'); process.exitCode = 1; });
}
