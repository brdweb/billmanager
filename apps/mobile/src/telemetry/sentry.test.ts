import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ init: vi.fn(), extra: {
  sentryDsn: 'https://public@example.invalid/1', releaseVersion: '1.2.0', buildEnvironment: 'preview' as unknown,
} }));
vi.mock('expo-application', () => ({ nativeBuildVersion: '20' }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: state.extra } } }));
vi.mock('expo-updates', () => ({ channel: null, runtimeVersion: null, isEnabled: false }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@sentry/react-native', () => ({ init: state.init }));
import { initializeSentry } from './sentry';

beforeEach(() => { vi.clearAllMocks(); state.extra.buildEnvironment = 'preview'; });

describe('Sentry initialization when native OTA is disabled', () => {
  it.each(['preview', 'production'])('retains the %s environment with null native update metadata', (environment) => {
    state.extra.buildEnvironment = environment;
    expect(initializeSentry()).toBe(true);
    expect(state.init).toHaveBeenCalledWith(expect.objectContaining({ environment,
      release: 'mobile-v1.2.0', dist: 'android-20', sendDefaultPii: false }));
  });
  it('does not send arbitrary embedded values as the diagnostic environment', () => {
    state.extra.buildEnvironment = 'private-metadata';
    initializeSentry();
    expect(state.init).toHaveBeenCalledWith(expect.objectContaining({ environment: 'production' }));
  });
});
