import type { ErrorEvent, ReactNativeOptions } from '@sentry/react-native';
import { describe, expect, it } from 'vitest';

import {
  createSentryOptions,
  scrubSentryEvent,
  sentryDist,
  sentryRelease,
} from './sentryPrivacy';

const SECRET = 'Bearer secret-token';
const PAYEE = 'Private Payee';
const AMOUNT = '1234.56';
const USER_URL = 'https://example.test/bills/private-id?token=secret-token#payee';
const DEBUG_ID = '01234567-89ab-4cde-8fab-0123456789ab';

describe('mobile Sentry privacy policy', () => {
  it('allowlists symbolication fields and removes sensitive event data', () => {
    const event: ErrorEvent = {
      event_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      message: `${PAYEE} failed for ${AMOUNT}`,
      logentry: { message: SECRET, params: [PAYEE, AMOUNT] },
      timestamp: 1_750_000_000,
      level: 'error',
      platform: 'javascript',
      type: undefined,
      release: 'mobile-v1.0.1-alpha.1',
      dist: 'ios-10',
      environment: 'preview',
      request: {
        url: USER_URL,
        data: { amount: AMOUNT, payee: PAYEE },
        headers: { authorization: SECRET },
      },
      user: { id: 'user-private-id', email: 'private@example.test' },
      breadcrumbs: [{ message: PAYEE, data: { url: USER_URL, amount: AMOUNT } }],
      extra: { payee: PAYEE, amount: AMOUNT, token: SECRET },
      tags: { account: 'private-account' },
      contexts: { bill: { payee: PAYEE, amount: AMOUNT } },
      transaction: USER_URL,
      fingerprint: [PAYEE, AMOUNT],
      exception: {
        values: [{
          type: 'PaymentError',
          value: `${PAYEE}: ${AMOUNT}`,
          mechanism: {
            type: 'generic',
            handled: false,
            data: { token: SECRET, url: USER_URL },
          },
          stacktrace: {
            frames: [{
              filename: `${USER_URL}?second=query`,
              abs_path: `${USER_URL}#fragment`,
              function: 'submitPayment',
              lineno: 42,
              colno: 7,
              vars: { payee: PAYEE, amount: AMOUNT },
              context_line: `throw new Error('${PAYEE}')`,
              pre_context: [SECRET],
              post_context: [USER_URL],
            }],
          },
        }],
      },
      threads: {
        values: [{
          id: 1,
          name: PAYEE,
          crashed: true,
          stacktrace: { frames: [{ filename: 'index.bundle?token=secret-token', lineno: 5 }] },
        }],
      },
      debug_meta: {
        images: [{ type: 'macho', debug_id: DEBUG_ID, image_addr: '0x100000000' }],
      },
    };
    const hint = { attachments: [{ filename: 'native-crash.txt', data: SECRET }] };

    const scrubbed = scrubSentryEvent(event, hint);
    const serialized = JSON.stringify(scrubbed);

    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(PAYEE);
    expect(serialized).not.toContain(AMOUNT);
    expect(serialized).not.toContain('private-id');
    expect(serialized).not.toContain('private@example.test');
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.contexts).toBeUndefined();
    expect(scrubbed.tags).toBeUndefined();
    expect(scrubbed.transaction).toBeUndefined();
    expect(scrubbed.fingerprint).toBeUndefined();
    expect(scrubbed.exception?.values?.[0]).toMatchObject({
      type: 'PaymentError',
      value: '[redacted]',
      mechanism: { type: 'generic', handled: false },
    });
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]).toMatchObject({
      filename: undefined,
      function: 'submitPayment',
      lineno: 42,
      colno: 7,
    });
    expect(scrubbed.debug_meta).toEqual(event.debug_meta);
    expect(hint.attachments).toEqual([]);
  });

  it('reconstructs SDK and debug metadata without unknown nested canaries', () => {
    const canary = 'PRIVATE_METADATA_CANARY';
    const event = {
      type: undefined,
      sdk: {
        name: 'sentry.javascript.react-native',
        version: '7.11.0',
        packages: [
          { name: 'npm:@sentry/react-native', version: '7.11.0', extra: { canary } },
          { name: canary, version: canary },
        ],
        integrations: [canary],
        settings: { infer_ip: 'auto', extra: { canary } },
        unknown: { nested: [canary] },
      },
      modules: { [canary]: canary, react: '19.1.0' },
      debug_meta: {
        unknown: { canary },
        images: [
          {
            type: 'sourcemap', debug_id: DEBUG_ID,
            code_file: 'app:///index.android.bundle?token=PRIVATE_METADATA_CANARY#private',
            unknown: { canary },
          },
          {
            type: 'macho', debug_id: DEBUG_ID, image_addr: '0x100000000',
            image_size: 4096, code_file: `/Users/${canary}/Application`,
            debug_file: canary, code_id: canary, unknown: { canary },
          },
          {
            type: 'wasm', debug_id: DEBUG_ID, code_file: `file:///home/${canary}/app.wasm`,
            debug_file: canary, code_id: canary,
          },
          { type: 'macho', debug_id: canary, image_addr: '0x100000000' },
          { type: 'macho', debug_id: DEBUG_ID, image_addr: canary },
          { type: canary, debug_id: DEBUG_ID, unknown: { canary } },
        ],
      },
    } as unknown as ErrorEvent;
    const scrubbed = scrubSentryEvent(event);

    expect(JSON.stringify(scrubbed)).not.toContain(canary);
    expect(scrubbed.sdk).toEqual({
      name: 'sentry.javascript.react-native',
      version: '7.11.0',
      packages: [{ name: 'npm:@sentry/react-native', version: '7.11.0' }],
    });
    expect(scrubbed.modules).toBeUndefined();
    expect(scrubbed.debug_meta?.images).toEqual([
      { type: 'sourcemap', debug_id: DEBUG_ID, code_file: 'app:///index.android.bundle' },
      {
        type: 'macho', debug_id: DEBUG_ID, image_addr: '0x100000000',
        image_size: 4096, code_file: undefined,
      },
      { type: 'wasm', debug_id: DEBUG_ID, code_file: '[redacted]' },
    ]);
    expect(scrubSentryEvent(scrubbed)).toEqual(scrubbed);
  });

  it.each([
    '//private.example/PRIVATE_PATH_CANARY/index.bundle',
    'https://private.example/PRIVATE_PATH_CANARY/index.bundle',
    'file:///Users/PRIVATE_PATH_CANARY/index.bundle',
    'content://PRIVATE_PATH_CANARY/index.bundle',
    'data:text/plain,PRIVATE_PATH_CANARY',
    'mailto:PRIVATE_PATH_CANARY',
    '/Users/PRIVATE_PATH_CANARY/index.bundle',
    'C:\\Users\\PRIVATE_PATH_CANARY\\index.bundle',
    '../PRIVATE_PATH_CANARY/index.bundle',
    'private/PRIVATE_PATH_CANARY.js',
    'app:///private/PRIVATE_PATH_CANARY.js',
  ])('omits private runtime paths: %s', (path) => {
    const scrubbed = scrubSentryEvent({
      type: undefined,
      exception: { values: [{ stacktrace: { frames: [{ filename: path, abs_path: path }] } }] },
      debug_meta: { images: [{ type: 'sourcemap', debug_id: DEBUG_ID, code_file: path }] },
    });
    const frame = scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame?.filename).toBeUndefined();
    expect(frame?.abs_path).toBeUndefined();
    expect(JSON.stringify(scrubbed)).not.toContain('PRIVATE_PATH_CANARY');
    expect(scrubbed.debug_meta?.images?.[0]?.debug_id).toBe(DEBUG_ID);
  });

  it('preserves canonical bundle, code symbols, and native crash addresses', () => {
    const frames = [
      {
        filename: 'index.android.bundle?token=SECRET_QUERY_CANARY',
        abs_path: 'app:///index.android.bundle#SECRET_QUERY_CANARY',
        function: 'Object.submitPayment', module: 'com.example.Payment',
        lineno: 42, colno: 7, in_app: true, platform: 'javascript',
        debug_id: DEBUG_ID,
      },
      {
        filename: 'main.jsbundle', function: 'facebook::react::Runtime::call(int)',
        module: 'libhermes.so', instruction_addr: '0x100001234', addr_mode: 'rel:0',
        platform: 'native', debug_id: DEBUG_ID,
      },
      { function: '-[PaymentController submit:]', module: 'PaymentController' },
      { function: 'operator new[]' },
    ];
    const scrubbed = scrubSentryEvent({
      type: undefined,
      release: 'mobile-v1.1.1', dist: 'ios-10', environment: 'production',
      exception: { values: [{
        type: 'Error', value: SECRET, thread_id: 1,
        mechanism: { type: 'generic', handled: false, synthetic: false },
        stacktrace: { frames },
      }] },
      threads: { values: [{ id: 1, crashed: true, current: true, main: true, stacktrace: { frames } }] },
    });
    const safeFrames = scrubbed.exception?.values?.[0]?.stacktrace?.frames;
    expect(safeFrames?.[0]).toMatchObject({
      ...frames[0], filename: 'index.android.bundle', abs_path: 'app:///index.android.bundle',
    });
    expect(safeFrames?.slice(1)).toEqual(frames.slice(1));
    expect(scrubbed.threads?.values?.[0]).toMatchObject({
      id: 1, crashed: true, current: true, main: true, stacktrace: { frames: safeFrames },
    });
    expect(scrubbed).toMatchObject({
      release: 'mobile-v1.1.1', dist: 'ios-10', environment: 'production',
      exception: { values: [{ thread_id: 1, mechanism: { handled: false, synthetic: false } }] },
    });
    expect(JSON.stringify(scrubbed)).not.toContain('SECRET_QUERY_CANARY');
  });

  it.each([
    'Private Payee payload', 'https://private.example/payload',
    '//private.example/payload', 'file:private', 'submitPayment?token=secret',
    'submitPayment#secret', '{"private":"payload"}', 'x'.repeat(300),
  ])('rejects payload-like frame functions and modules: %s', (symbol) => {
    const scrubbed = scrubSentryEvent({
      type: undefined,
      exception: { values: [{ stacktrace: { frames: [{
        function: symbol, module: symbol, module_metadata: { private: symbol },
      }] } }] },
    });
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]).toMatchObject({
      function: undefined, module: undefined,
    });
    expect(JSON.stringify(scrubbed)).not.toContain(symbol);
  });

  it('rejects malformed frame symbolication values and arbitrary added fields', () => {
    const canary = 'PRIVATE_FRAME_CANARY';
    const frame = {
      filename: canary, abs_path: canary, function: `${canary} payload`, module: `${canary} payload`,
      debug_id: canary, instruction_addr: canary, addr_mode: canary, platform: canary,
      lineno: { canary }, colno: canary, in_app: { canary },
      module_metadata: { deeply: { canary } }, unknown: { canary },
    };
    const scrubbed = scrubSentryEvent({
      type: undefined,
      exception: { values: [{ stacktrace: { frames: [frame] } }] },
      threads: { values: [{ stacktrace: { frames: [frame] } }] },
    } as unknown as ErrorEvent);
    expect(JSON.stringify(scrubbed)).not.toContain(canary);
  });

  it('replaces attacker-controlled exception types', () => {
    const scrubbed = scrubSentryEvent({
      type: undefined,
      exception: { values: [{ type: `Error ${SECRET}`, value: SECRET }] },
    });
    expect(scrubbed.exception?.values?.[0]).toMatchObject({
      type: 'Error',
      value: '[redacted]',
    });
  });

  it('fixes collection policy while preserving release health', () => {
    const options = createSentryOptions({
      dsn: 'https://public@example.test/1',
      releaseVersion: '1.0.1-alpha.1',
      nativeBuildVersion: '10',
      platform: 'ios',
      environment: 'preview',
    });

    expect(options).toMatchObject({
      release: 'mobile-v1.0.1-alpha.1',
      dist: 'ios-10',
      environment: 'preview',
      sendDefaultPii: false,
      enableAutoSessionTracking: true,
      enableNativeCrashHandling: true,
      enableNdkScopeSync: false,
      attachThreads: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      enableLogs: false,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      tracePropagationTargets: [],
      maxBreadcrumbs: 0,
    } satisfies Partial<ReactNativeOptions>);
    expect(options.beforeBreadcrumb?.({ message: SECRET })).toBeNull();
    expect(options.beforeScreenshot?.({}, {})).toBe(false);
  });

  it('rejects non-monotonic or unsafe identity values', () => {
    expect(sentryRelease('1.0.1-alpha.1')).toBe('mobile-v1.0.1-alpha.1');
    expect(sentryDist('android', '12')).toBe('android-12');
    expect(() => sentryRelease('')).toThrow(/release version/);
    expect(() => sentryDist('ios', '10/user')).toThrow(/build identity/);
  });
});
