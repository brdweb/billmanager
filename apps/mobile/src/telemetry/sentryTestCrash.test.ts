import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  extra: {} as Record<string, unknown>,
  nativeCrash: vi.fn(),
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

vi.mock('@sentry/react-native', () => ({
  nativeCrash: state.nativeCrash,
}));

import {
  isSentryTestCrashEnabled,
  triggerSentryNativeTestCrash,
} from './sentryTestCrash';

describe('Sentry native test crash harness', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DEV__ = false;
    state.extra = {};
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
});
