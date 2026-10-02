import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

type MobileExtra = {
  sentryDsn?: unknown;
  sentryTestCrashEnabled?: unknown;
};

function configuredExtra(): MobileExtra {
  return (Constants.expoConfig?.extra ?? {}) as MobileExtra;
}

/**
 * The native-crash action is intentionally limited to the temporary Android
 * preview binary. A configured DSN is also required so an operator cannot
 * crash the app when there is no client capable of uploading the event.
 */
export function isSentryTestCrashEnabled(): boolean {
  const extra = configuredExtra();
  return !__DEV__
    && extra.sentryTestCrashEnabled === true
    && typeof extra.sentryDsn === 'string'
    && extra.sentryDsn.trim().length > 0;
}

export function triggerSentryNativeTestCrash(): void {
  if (!isSentryTestCrashEnabled()) {
    throw new Error('Sentry native test crash is unavailable in this build.');
  }
  Sentry.nativeCrash();
}
