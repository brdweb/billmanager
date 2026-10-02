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
        images: [{ type: 'macho', debug_id: 'SAFE-DEBUG-ID', image_addr: '0x100000000' }],
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
      filename: '[redacted-url]',
      function: 'submitPayment',
      lineno: 42,
      colno: 7,
    });
    expect(scrubbed.debug_meta).toEqual(event.debug_meta);
    expect(hint.attachments).toEqual([]);
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
