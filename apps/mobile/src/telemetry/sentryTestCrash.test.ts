import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  extra: {} as Record<string, unknown>,
  platform: 'android',
  clientAvailable: true,
  nativeCrash: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(),
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      get extra() {
        return state.extra;
      },
    },
  },
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
}));

vi.mock('@sentry/react-native', () => ({
  nativeCrash: state.nativeCrash,
  captureException: state.captureException,
  getClient: () => state.clientAvailable ? { flush: state.flush } : undefined,
}));

import {
  isSentryTestCrashEnabled,
  triggerSentryJavaScriptTestError,
  triggerSentryNativeTestCrash,
} from './sentryTestCrash';

describe('Sentry preview validation harness', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DEV__ = false;
    state.extra = {};
    state.platform = 'android';
    state.clientAvailable = true;
    vi.resetAllMocks();
  });

  it('is available only when the preview flag and a DSN are present', () => {
    state.extra = {
      sentryDsn: 'https://public@example.invalid/1',
      sentryTestCrashEnabled: true,
    };

    expect(isSentryTestCrashEnabled()).toBe(true);

    state.extra.sentryTestCrashEnabled = false;
    expect(isSentryTestCrashEnabled()).toBe(false);

    state.extra.sentryTestCrashEnabled = true;
    state.extra.sentryDsn = '   ';
    expect(isSentryTestCrashEnabled()).toBe(false);
  });

  it('stays unavailable in a development runtime', () => {
    state.extra = {
      sentryDsn: 'https://public@example.invalid/1',
      sentryTestCrashEnabled: true,
    };
    (globalThis as Record<string, unknown>).__DEV__ = true;

    expect(isSentryTestCrashEnabled()).toBe(false);
  });

  it('refuses to invoke the native crash when the gate is closed', () => {
    expect(() => triggerSentryNativeTestCrash()).toThrow(
      'Sentry native test crash is unavailable in this build.',
    );
    expect(state.nativeCrash).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { sentryTestCrashEnabled: false, sentryDsn: 'https://public@example.invalid/1' },
    { sentryTestCrashEnabled: 'true', sentryDsn: 'https://public@example.invalid/1' },
    { sentryTestCrashEnabled: true, sentryDsn: '   ' },
    { sentryTestCrashEnabled: true, sentryDsn: 123 },
  ])('refuses JavaScript capture and flushing with a closed gate: %j', async (extra) => {
    state.extra = extra;

    await expect(triggerSentryJavaScriptTestError()).rejects.toThrow(
      'Sentry JavaScript test error is unavailable in this build.',
    );
    expect(state.captureException).not.toHaveBeenCalled();
    expect(state.flush).not.toHaveBeenCalled();
  });

  it('refuses JavaScript capture in a development runtime even with the preview flag', async () => {
    state.extra = {
      sentryDsn: 'https://public@example.invalid/1',
      sentryTestCrashEnabled: true,
    };
    (globalThis as Record<string, unknown>).__DEV__ = true;

    await expect(triggerSentryJavaScriptTestError()).rejects.toThrow(
      'Sentry JavaScript test error is unavailable in this build.',
    );
    expect(state.captureException).not.toHaveBeenCalled();
    expect(state.flush).not.toHaveBeenCalled();
  });

  it.each(['ios', 'web'])('refuses both actions on %s even with the preview flag', async (platform) => {
    state.platform = platform;
    state.extra = {
      sentryDsn: 'https://public@example.invalid/1',
      sentryTestCrashEnabled: true,
    };

    expect(isSentryTestCrashEnabled()).toBe(false);
    await expect(triggerSentryJavaScriptTestError()).rejects.toThrow(
      'Sentry JavaScript test error is unavailable in this build.',
    );
    expect(() => triggerSentryNativeTestCrash()).toThrow(
      'Sentry native test crash is unavailable in this build.',
    );
    expect(state.captureException).not.toHaveBeenCalled();
    expect(state.flush).not.toHaveBeenCalled();
    expect(state.nativeCrash).not.toHaveBeenCalled();
  });

  it('refuses capture when no Sentry client is initialized', async () => {
    state.extra = {
      sentryDsn: 'https://public@example.invalid/1',
      sentryTestCrashEnabled: true,
    };
    state.clientAvailable = false;

    await expect(triggerSentryJavaScriptTestError()).rejects.toThrow(
      'Sentry JavaScript test error requires an initialized client.',
    );
    expect(state.captureException).not.toHaveBeenCalled();
    expect(state.flush).not.toHaveBeenCalled();
  });

  it('does not report flush success when the SDK rejects the upload attempt', async () => {
    state.extra = {
      sentryDsn: 'https://public@example.invalid/1',
      sentryTestCrashEnabled: true,
    };
    state.flush.mockRejectedValue(new Error('transport unavailable'));

    await expect(triggerSentryJavaScriptTestError()).rejects.toThrow('transport unavailable');
    expect(state.nativeCrash).not.toHaveBeenCalled();
  });
});
