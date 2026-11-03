import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loginCommands, captureCommands, verifyDemo, safeScreenshots, runCapture, safeCommandFailure, sealPrivateDiagnostics, LOGIN_STEPS, CONFIRM_OPEN, DECLINE_SAVE_PASSWORD, CAPTURE_RETRIES, APP_READY } from './ios-store-capture.mjs';
const password = 'synthetic-fixture-only-not-a-credential';
const data = {
  '/auth/login': { access_token: 'fixture-token' },
  '/me': { user: { id: 25, username: 'store-review', role: 'admin', is_account_owner: true }, databases: [{ id: 23, name: 'reviewer-demo' }] },
  '/billing/status': { effective_tier: 'pro', status: 'active', plan: 'review_demo', can_manage_subscription: false },
  '/bills?include_archived=true': ['Salary', 'Rent', 'Utilities', 'Internet'].map((n, i) => ({ id: 71 + i, name: `DEMO ${n}`, database_id: 23 })),
  '/settlements': { owed_to_me: [], i_owe: [], settled: [], people: [] },
  '/payments': [{ id: 654, bill_id: 72, database_id: 23 }, { id: 655, bill_id: 73, database_id: 23 }],
};
const api = (values = data, calls = []) => async (url, options) => {
  calls.push({ url, options }); return { status: 200, json: async () => ({ success: true, data: values[url.replace('https://app.billmanager.app/api/v2', '')] }) };
};
const png = (width, height) => { const b = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(b); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); return b; };
const preparedDevices = [{ family: 'iphone', udid: 'fixture' }, { family: 'ipad', udid: 'fixture2' }];
const writePrepared = (out, devices = preparedDevices) => {
  writeFileSync(join(out, 'selected-devices.json'), JSON.stringify(devices));
  writeFileSync(join(out, 'simulator-readiness.json'), JSON.stringify({ passed: true, devices }));
};
const stateResult = () => ({ status: 0, stdout: JSON.stringify({ devices: { 'iOS-26-5': ['fixture', 'fixture2', 'phone', 'pad'].map(udid => ({ udid, state: 'Booted' })) } }) });
const flat = commands => commands.flatMap(c => [c, ...flat(c.runFlow?.commands ?? c.retry?.commands ?? [])]);
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
    const login = flat(loginCommands).filter(c => !c.runFlow);
    expect(login.some(c => c.takeScreenshot)).toBe(false);
    const firstLink = login.findIndex(c => c.openLink);
    expect(login[firstLink - 1]).toEqual({ extendedWaitUntil: { notVisible: { id: 'auth-login-screen' }, timeout: 60000 } });
    const capture = flat(captureCommands);
    expect(capture.some(c => c.inputText)).toBe(false);
    // The only taps after sign-in confirm the iOS "Open in BillManager?" system prompt.
    expect(capture.filter(c => c.tapOn)).toEqual(Array(4).fill(CONFIRM_OPEN));
    for (const [i, c] of capture.entries()) if (c.openLink) expect(capture[i + 1]).toEqual(CONFIRM_OPEN);
    expect(capture.filter(c => c.takeScreenshot).map(c => c.takeScreenshot)).toEqual(['bills', 'payment-history', 'settlements', 'billing']);
    expect(capture.filter(c => c.assertNotVisible?.id === 'auth-login-screen')).toHaveLength(4);
  });
  it('captures each screen from a fresh signed-in launch with a bounded relaunch retry', () => {
    expect(CAPTURE_RETRIES).toBe(2);
    for (const block of captureCommands) {
      expect(Object.keys(block)).toEqual(['retry']);
      expect(block.retry.maxRetries).toBe(CAPTURE_RETRIES);
      expect(block.retry.commands[0]).toEqual({ launchApp: { clearState: false } });
      // The deep link is only opened once the relaunched app shows its signed-in Home.
      expect(block.retry.commands[1]).toEqual(APP_READY);
      expect(APP_READY).toEqual({ extendedWaitUntil: { visible: { text: '^Overview$' }, timeout: 60000 } });
      expect(block.retry.commands[2].openLink).toMatch(/^billmanager:\/\//);
      expect(block.retry.commands.at(-1).takeScreenshot).toBeTruthy();
    }
    expect(flat(captureCommands).filter(c => c.launchApp)).toEqual(Array(4).fill({ launchApp: { clearState: false } }));
    // Payment rows are below the fold on iPhone; only on-screen header/summary text is asserted.
    const payments = captureCommands[1].retry.commands.filter(c => c.extendedWaitUntil?.visible?.text && c !== APP_READY).map(c => c.extendedWaitUntil.visible.text);
    expect(payments).toEqual(['Payment history', 'Net total']);
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
    writePrepared(out);
    const calls = [];
    try {
      await expect(runCapture(password, { runnerTemp: root, request: api(), run: (command, args, options) => {
        calls.push({ command, args, options }); if (command === 'xcrun' && args[1] === 'list') return stateResult(); return { status: command === 'maestro' ? 1 : 0, stdout: password, stderr: 'Bearer fixture-token' };
      } })).rejects.toThrow('raw diagnostics withheld');
      expect(calls.some(c => c.command === 'maestro')).toBe(true);
      expect(calls.filter(c => c.command === 'maestro').every(c => c.options.env.MAESTRO_CLI_NO_ANALYTICS === 'true')).toBe(true);
      expect(calls.every(c => !JSON.stringify(c.args).includes(password))).toBe(true);
      expect(calls.filter(c => c.options.env?.MAESTRO_QA_REVIEWER_PASSWORD).map(c => c.command)).toEqual(['maestro']);
      expect(JSON.parse(readFileSync(join(out, 'store-capture.json'), 'utf8'))).toMatchObject({ stage: 'iphone-login', failure: { process: 'nonzero_exit', exitCode: 1, category: 'unclassified' } });
      expect(calls.every(c => !c.options.env || c.options.env.HOME === process.env.HOME)).toBe(true);
      expect(existsSync(join(out, 'store-screenshots'))).toBe(false);
      expect(readdirSync(root)).toEqual(['billmanager-ios-qa']);
    } finally { rmSync(root, { recursive: true }); }
  });
});

it('promotes eight allowlisted PNGs only after both complete; later-device failure removes all', async () => {
  for (const failSecond of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), 'qa-promotion-test-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out);
    writePrepared(out, [{ family: 'iphone', udid: 'phone' }, { family: 'ipad', udid: 'pad' }]);
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({ sourceCommit: 'reviewed-fixture' }));
    let completed = 0;
    const run = (command, args) => {
      if (command === 'xcrun' && args[1] === 'list') return stateResult();
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

it('exports only bounded command type/status/index, never private values or errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-command-diagnostic-'));
  try {
    const nested = join(root, '2026-10-30', 'login'); mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'commands-(login).json'), JSON.stringify([
      { command: { launchAppCommand: {} }, metadata: { status: 'COMPLETED' } },
      { command: { inputTextCommand: { text: password } }, metadata: { status: 'FAILED', error: { message: password, debugMessage: 'Bearer fixture-token' } } },
    ]));
    const report = safeCommandFailure(root, { status: 1, stdout: `Element not found: ${password}` });
    expect(report).toEqual({ process: 'nonzero_exit', exitCode: 1, category: 'element_not_found', command: { ordinal: 2, type: 'inputTextCommand', status: 'FAILED' } });
    expect(JSON.stringify(report)).not.toMatch(/synthetic-fixture|Bearer|fixture-token/);
    expect(safeCommandFailure('/missing-fixture', { error: { code: 'ETIMEDOUT', message: password }, status: null }).process).toBe('timeout');
  } finally { rmSync(root, { recursive: true }); }
});

it('accepts the observed third legitimate demo payment while retaining both baseline payments', async () => {
  const current = structuredClone(data);
  current['/payments'].push({ id: 656, bill_id: 71, database_id: 23 });
  await expect(verifyDemo(password, api(current))).resolves.toEqual({ user: 25, database: 23, bills: 4, payments: 3 });
});

it.each(['foreign tenant', 'unapproved bill', 'missing baseline', 'duplicate ID', 'excess rows'])('rejects additional-payment boundary drift: %s', async kind => {
  const current = structuredClone(data);
  current['/payments'].push({ id: 656, bill_id: 71, database_id: 23 });
  if (kind === 'foreign tenant') current['/payments'][2].database_id = 24;
  if (kind === 'unapproved bill') current['/payments'][2].bill_id = 999;
  if (kind === 'missing baseline') current['/payments'][0].id = 657;
  if (kind === 'duplicate ID') current['/payments'][2].id = 654;
  if (kind === 'excess rows') current['/payments'].push(...Array.from({ length: 98 }, (_, i) => ({ id: 700 + i, bill_id: 71, database_id: 23 })));
  await expect(verifyDemo(password, api(current))).rejects.toMatchObject({ diagnostic: { substage: 'payments', category: 'payment_boundary' } });
});

it.each([
  ['login', '/auth/login'], ['me', '/me'], ['billing', '/billing/status'],
  ['bills', '/bills?include_archived=true'], ['payments', '/payments'], ['settlements', '/settlements'],
])('reports only fixed %s preflight substage and bounded HTTP status', async (substage, path) => {
  const normal = api();
  const request = (url, options) => url === 'https://app.billmanager.app/api/v2' + path
    ? Promise.resolve({ status: 403, json: async () => ({ error: password, token: 'fixture-token' }) }) : normal(url, options);
  await expect(verifyDemo(password, request)).rejects.toMatchObject({ diagnostic: { substage, category: 'http_rejected', httpStatus: 403 } });
});

it('fails closed before UI and exports no request/response/error secrets on preflight failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-preflight-privacy-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out);
  writePrepared(out);
  let commands = 0;
  try {
    await expect(runCapture(password, { runnerTemp: root, run: () => { commands++; return { status: 0 }; },
      request: async () => { throw new Error(`${password} Bearer fixture-token`); } })).rejects.toThrow('raw diagnostics withheld');
    const result = readFileSync(join(out, 'store-capture.json'), 'utf8');
    expect(JSON.parse(result)).toEqual({ passed: false, code: 'private_capture_failed', stage: 'identity', commandTimings: [], failure: { preflight: { substage: 'login', category: 'transport' } }, diagnostics: { sealed: false, reason: 'no_recipient' } });
    expect(result).not.toMatch(/synthetic-fixture|Bearer|fixture-token/);
    expect(commands).toBe(0);
    expect(readdirSync(root)).toEqual(['billmanager-ios-qa']);
    expect(existsSync(join(out, 'store-screenshots'))).toBe(false);
  } finally { rmSync(root, { recursive: true }); }
});
it('rejects absent public preparation before any API or UI dispatch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-unprepared-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out);
  writeFileSync(join(out, 'selected-devices.json'), JSON.stringify(preparedDevices));
  let calls = 0;
  try {
    await expect(runCapture(password, { runnerTemp: root, request: async () => { calls++; }, run: () => { calls++; } })).rejects.toThrow();
    expect(calls).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'store-capture.json'), 'utf8'))).toMatchObject({ passed: false, stage: 'local-devices' });
  } finally { rmSync(root, { recursive: true }); }
});

it.each(['read', 'write'])('always deletes private state when cleanup-report %s fails', async operation => {
  const root = mkdtempSync(join(tmpdir(), 'qa-cleanup-io-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out); writePrepared(out);
  let injected = false;
  try {
    await expect(runCapture(password, { runnerTemp: root, request: api(),
      run: (command, args) => command === 'xcrun' && args[1] === 'list' ? stateResult() : { status: command === 'maestro' ? 1 : 0, stdout: password },
      recordCleanup: () => { injected = true; throw new Error(`${operation} failed: ${password} Bearer fixture-token`); },
    })).rejects.toThrow('Private screenshot capture failed; raw diagnostics withheld');
    expect(injected).toBe(true);
    expect(readdirSync(root)).toEqual(['billmanager-ios-qa']);
    expect(existsSync(join(out, 'store-screenshots'))).toBe(false);
    const report = readFileSync(join(out, 'store-capture.json'), 'utf8');
    expect(JSON.parse(report).stage).toBe('iphone-login');
    expect(report).not.toMatch(/synthetic-fixture|Bearer|fixture-token/);
  } finally { rmSync(root, { recursive: true }); }
});

it.each([
  ['No visible element found: Text matching regex: ^Password$, Index: 1', 'element_not_found'],
  ['Assertion is false: id: auth-login-screen is not visible', 'assertion_false'],
  ["Couldn't hide the keyboard. This can happen if the app uses a custom input or doesn't expose a standard dismiss action.", 'keyboard_not_hidden'],
  ['Unable to launch app com.brdweb.billmanager', 'app_launch_failed'],
])('maps the Maestro 2.12 failure message to a fixed category: %s', (message, category) => {
  const report = safeCommandFailure('/missing-fixture', { status: 1, stdout: `${password}\n${message}` });
  expect(report.category).toBe(category);
  expect(JSON.stringify(report)).not.toContain(password);
});


it('splits login into labelled steps, submits with Return plus a guarded Sign in fallback and never uses hideKeyboard', () => {
  expect(loginCommands.map(c => c.runFlow?.label)).toEqual(LOGIN_STEPS.map(step => `qa-login-step-${step}`));
  expect(LOGIN_STEPS).toEqual(['launch', 'username', 'password', 'submit', 'post-login', 'deep-link']);
  const step = name => loginCommands[LOGIN_STEPS.indexOf(name)].runFlow.commands;
  expect(flat(loginCommands).some(c => 'hideKeyboard' in c)).toBe(false);
  expect(step('launch')[0]).toEqual({ launchApp: { clearState: true } });
  expect(flat(loginCommands).filter(c => c.launchApp)).toHaveLength(1);
  for (const name of LOGIN_STEPS.filter(name => name !== 'password')) expect(JSON.stringify(step(name))).not.toContain('MAESTRO_QA_REVIEWER_PASSWORD');
  expect(step('password').at(-1)).toEqual({ inputText: '${MAESTRO_QA_REVIEWER_PASSWORD}' });
  const signIn = { text: '^Sign in$', index: 1, enabled: true };
  expect(step('submit')).toEqual([
    { pressKey: 'Enter' },
    { runFlow: { when: { visible: signIn }, commands: [{ tapOn: { text: '^Sign in$', index: 1 } }] } },
    { extendedWaitUntil: { notVisible: signIn, timeout: 15000 } },
  ]);
  // The only Sign in tap is the guarded fallback, after Return.
  expect(flat(loginCommands).filter(c => c.tapOn?.text === '^Sign in$')).toHaveLength(1);
  expect(step('post-login')[0]).toEqual({ extendedWaitUntil: { notVisible: { id: 'auth-login-screen' }, timeout: 60000 } });
  expect(flat(loginCommands).filter(c => c.openLink)).toEqual([{ openLink: 'billmanager://bills' }]);
  expect(step('deep-link').slice(0, 3)).toEqual([{ openLink: 'billmanager://bills' }, CONFIRM_OPEN, DECLINE_SAVE_PASSWORD]);
  expect(CONFIRM_OPEN).toEqual({ tapOn: { text: '^Open$', optional: true } });
  expect(DECLINE_SAVE_PASSWORD).toEqual({ tapOn: { text: '^Not Now$', optional: true } });
});

it('names the failing login step from the private command report using fixed labels only', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-login-step-'));
  try {
    const nested = join(root, 'login', '2026-11-02_120000', 'login'); mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'login', 'commands-broken.json'), '{not json');
    const run = label => ({ command: { runFlowCommand: { label, commands: [] } }, metadata: { status: label.endsWith('password') ? 'FAILED' : 'COMPLETED', depth: 0 } });
    writeFileSync(join(nested, 'commands.json'), JSON.stringify([
      run('qa-login-step-launch'), { command: { launchAppCommand: {} }, metadata: { status: 'COMPLETED', depth: 1 } },
      run('qa-login-step-username'), run('qa-login-step-password'),
      { command: { tapOnElement: { selector: { textRegex: '^Password$' } } }, metadata: { status: 'COMPLETED', depth: 1 } },
      { command: { inputTextCommand: { text: password } }, metadata: { status: 'FAILED', depth: 1, error: { message: password } } },
    ]));
    const report = safeCommandFailure(root, { status: 1, stdout: `qa-login-step-launch... COMPLETED\nqa-login-step-deep-link ${password}` });
    expect(report).toMatchObject({ step: 'password', stepSource: 'command_report', command: { ordinal: 6, type: 'inputTextCommand', status: 'FAILED' } });
    expect(JSON.stringify(report)).not.toMatch(/synthetic-fixture|Password/);
  } finally { rmSync(root, { recursive: true }); }
});

it('reports the innermost failed command inside a capture retry, not the retry wrapper', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-capture-retry-'));
  try {
    const nested = join(root, 'capture', '2026-11-03_120000', 'capture'); mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'commands.json'), JSON.stringify([
      { command: { retryCommand: { maxRetries: 2, commands: [] } }, metadata: { status: 'FAILED', depth: 0 } },
      { command: { launchAppCommand: {} }, metadata: { status: 'COMPLETED', depth: 1 } },
      { command: { openLinkCommand: {} }, metadata: { status: 'COMPLETED', depth: 1 } },
      { command: { assertConditionCommand: {} }, metadata: { status: 'FAILED', depth: 1, error: { message: password } } },
    ]));
    const report = safeCommandFailure(root, { status: 1, stdout: password });
    expect(report.command).toEqual({ ordinal: 4, type: 'assertConditionCommand', status: 'FAILED' });
    expect(JSON.stringify(report)).not.toContain(password);
  } finally { rmSync(root, { recursive: true }); }
});

it('attributes a failed fallback Sign in tap to the submit step', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-login-submit-'));
  try {
    const row = (command, status) => ({ command, metadata: { status } });
    writeFileSync(join(root, 'commands.json'), JSON.stringify([
      row({ runFlowCommand: { label: 'qa-login-step-password', commands: [] } }, 'COMPLETED'),
      row({ runFlowCommand: { label: 'qa-login-step-submit', commands: [] } }, 'FAILED'),
      row({ pressKeyCommand: { code: 'ENTER' } }, 'COMPLETED'),
      row({ runFlowCommand: { commands: [] } }, 'FAILED'),
      row({ tapOnElement: { selector: { textRegex: '^Sign in$' } } }, 'FAILED'),
    ]));
    expect(safeCommandFailure(root, { status: 1, stdout: 'Element not found: Text matching regex: ^Sign in$' })).toEqual({
      process: 'nonzero_exit', exitCode: 1, category: 'element_not_found', step: 'submit', stepSource: 'command_report',
      command: { ordinal: 5, type: 'tapOnElement', status: 'FAILED' } });
  } finally { rmSync(root, { recursive: true }); }
});

it('falls back to the last started fixed console step marker and never invents one', () => {
  const console = 'Running on iPhone\n > Flow login\nqa-login-step-launch...\nqa-login-step-launch... COMPLETED\nqa-login-step-username...\nqa-login-step-username... COMPLETED\nqa-login-step-password...\nqa-login-step-password... COMPLETED\nqa-login-step-submit...\nqa-login-step-submit... COMPLETED\nqa-login-step-post-login...\n  Assert that id: auth-login-screen is not visible... FAILED\nqa-login-step-post-login... FAILED\nAssertion is false: id: auth-login-screen is not visible';
  expect(safeCommandFailure('/missing-fixture', { status: 1, stdout: console })).toEqual({
    process: 'nonzero_exit', exitCode: 1, category: 'assertion_false', step: 'post-login', stepSource: 'console' });
  expect(safeCommandFailure('/missing-fixture', { status: 1, stdout: 'qa-login-step-unknown... qa-login-step-post-loginx' })).not.toHaveProperty('step');
});

it('publishes the failing login step in the safe capture report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-step-report-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out); writePrepared(out);
  try {
    await expect(runCapture(password, { runnerTemp: root, request: api(), run: (command, args) => {
      if (command === 'xcrun' && args[1] === 'list') return stateResult();
      if (command === 'maestro') return { status: 1, stdout: `qa-login-step-launch...\nqa-login-step-launch... COMPLETED\nqa-login-step-username...\n${password}\nNo visible element found: Text matching regex: ^Username$` };
      return { status: 0 };
    } })).rejects.toThrow('raw diagnostics withheld');
    const text = readFileSync(join(out, 'store-capture.json'), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ stage: 'iphone-login', failure: { category: 'element_not_found', step: 'username', stepSource: 'console', stage: 'iphone-login' } });
    expect(text).not.toMatch(/synthetic-fixture|Bearer|fixture-token|Username/);
  } finally { rmSync(root, { recursive: true }); }
});

const recipient = 'age1q7kk9d5j2ttwp8v3l4wdrnjv6560da3wjzgxewjvtrepeg43lcsscmeze4';
describe('sealed private diagnostics', () => {
  it('seals nothing without a well-formed age recipient', () => {
    const calls = [];
    for (const bad of [undefined, '', 'age1short', `${recipient}\n`, `AGE-SECRET-KEY-1${'Q'.repeat(58)}`, recipient.replace('q7', 'b7')]) {
      expect(sealPrivateDiagnostics('/missing', '/missing/out', bad, (...c) => { calls.push(c); return { status: 0 }; })).toEqual({ sealed: false, reason: 'no_recipient' });
    }
    expect(calls).toEqual([]);
  });
  it('archives only the private directory, encrypts to the recipient and removes the plaintext archive', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-seal-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out);
    const priv = join(root, 'billmanager-ios-private-x'); mkdirSync(priv); writeFileSync(join(priv, 'last-command.log'), 'raw');
    const calls = [];
    try {
      const result = sealPrivateDiagnostics(priv, out, recipient, (command, args, options) => {
        calls.push({ command, args, options });
        if (command === '/usr/bin/tar') writeFileSync(args[1], 'plaintext');
        if (command === 'age') writeFileSync(args[3], 'ciphertext');
        return { status: 0 };
      });
      expect(result).toEqual({ sealed: true });
      expect(calls.map(c => c.command)).toEqual(['/usr/bin/tar', 'age']);
      expect(calls.every(c => JSON.stringify(Object.keys(c.options.env)) === '["PATH"]')).toBe(true);
      expect(calls[0].args.slice(2)).toEqual(['-C', priv, '.']);
      expect(calls[1].args.slice(0, 4)).toEqual(['-r', recipient, '-o', join(out, 'sealed-capture-failure.tar.age')]);
      expect(calls[1].args[4]).toBe(calls[0].args[1]);
      expect(existsSync(calls[0].args[1])).toBe(false);
      expect(readdirSync(root).sort()).toEqual(['billmanager-ios-private-x', 'billmanager-ios-qa']);
      expect(readFileSync(join(out, 'sealed-capture-failure.tar.age'), 'utf8')).toBe('ciphertext');
    } finally { rmSync(root, { recursive: true }); }
  });
  it('leaves no partial ciphertext when encryption fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-seal-fail-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out);
    try {
      expect(sealPrivateDiagnostics(root, out, recipient, (command, args) => {
        if (command === 'age') { writeFileSync(args[3], 'partial'); return { status: 1 }; }
        return { status: 0 };
      })).toEqual({ sealed: false, reason: 'encrypt_failed' });
      expect(readdirSync(out)).toEqual([]);
      expect(readdirSync(root)).toEqual(['billmanager-ios-qa']);
    } finally { rmSync(root, { recursive: true }); }
  });
  it('seals on a login failure, records only the outcome and still removes private state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-seal-run-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out); writePrepared(out);
    const calls = [];
    try {
      await expect(runCapture(password, { runnerTemp: root, request: api(), diagnosticsRecipient: recipient, run: (command, args, options) => {
        calls.push({ command, args, options });
        if (command === 'xcrun' && args[1] === 'list') return stateResult();
        if (command === 'maestro') return { status: 1, stdout: password };
        if (command === 'age') writeFileSync(args[3], 'ciphertext');
        return { status: 0 };
      } })).rejects.toThrow('raw diagnostics withheld');
      const text = readFileSync(join(out, 'store-capture.json'), 'utf8');
      expect(JSON.parse(text)).toMatchObject({ stage: 'iphone-login', diagnostics: { sealed: true } });
      expect(text).not.toContain(password);
      const maestro = calls.filter(c => c.command === 'maestro');
      expect(maestro.every(c => c.options.env.MAESTRO_DRIVER_STARTUP_TIMEOUT === '300000' && !('QA_DIAGNOSTICS_AGE_RECIPIENT' in c.options.env))).toBe(true);
      expect(calls.filter(c => c.command === '/usr/bin/tar' || c.command === 'age').every(c => Object.keys(c.options.env).join() === 'PATH')).toBe(true);
      expect(readdirSync(out).sort()).toEqual(['sealed-capture-failure.tar.age', 'selected-devices.json', 'simulator-readiness.json', 'store-capture.json']);
      expect(readdirSync(root)).toEqual(['billmanager-ios-qa']);
    } finally { rmSync(root, { recursive: true }); }
  });
  it('removes staging and uploads nothing when archiving fails or the runner throws', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-seal-archive-')); const out = join(root, 'billmanager-ios-qa'); mkdirSync(out);
    const priv = join(root, 'priv'); mkdirSync(priv); writeFileSync(join(priv, 'raw.log'), 'raw');
    try {
      expect(sealPrivateDiagnostics(priv, out, recipient, () => ({ status: 2 }))).toEqual({ sealed: false, reason: 'archive_failed' });
      expect(() => sealPrivateDiagnostics(priv, out, recipient, () => { throw new Error('spawn'); })).toThrow('spawn');
      expect(readdirSync(out)).toEqual([]);
      expect(readdirSync(root).sort()).toEqual(['billmanager-ios-qa', 'priv']);
    } finally { rmSync(root, { recursive: true }); }
  });
  it('seals nothing when no private output exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-seal-empty-')); const priv = join(root, 'priv'); mkdirSync(priv);
    const calls = [];
    try {
      for (const dir of [priv, join(root, 'missing')]) {
        expect(sealPrivateDiagnostics(dir, root, recipient, (...c) => { calls.push(c); return { status: 0 }; })).toEqual({ sealed: false, reason: 'nothing_to_seal' });
      }
      expect(calls).toEqual([]);
    } finally { rmSync(root, { recursive: true }); }
  });
});
