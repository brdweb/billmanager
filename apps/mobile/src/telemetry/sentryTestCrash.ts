import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

type MobileExtra = {
  sentryDsn?: unknown;
  sentryTestCrashEnabled?: unknown;
};

function configuredExtra(): MobileExtra {
  return (Constants.expoConfig?.extra ?? {}) as MobileExtra;
}

/**
 * The validation actions are intentionally limited to the temporary Android
 * preview binary. A configured DSN is also required so an operator cannot
 * run a test when there is no client capable of uploading the event.
 */
export function isSentryTestCrashEnabled(): boolean {
  const extra = configuredExtra();
  return !__DEV__
    && Platform.OS === 'android'
    && extra.sentryTestCrashEnabled === true
    && typeof extra.sentryDsn === 'string'
    && extra.sentryDsn.trim().length > 0;
}

export async function triggerSentryJavaScriptTestError(): Promise<boolean> {
  if (!isSentryTestCrashEnabled()) {
    throw new Error('Sentry JavaScript test error is unavailable in this build.');
  }
  const client = Sentry.getClient();
  if (!client) {
    throw new Error('Sentry JavaScript test error requires an initialized client.');
  }
  // Keep this synthetic error at an app-owned location for source-map validation.
  Sentry.captureException(new Error('BillManager internal preview JavaScript validation error'));
  return client.flush(5000);
}

export function triggerSentryNativeTestCrash(): void {
  if (!isSentryTestCrashEnabled()) {
    throw new Error('Sentry native test crash is unavailable in this build.');
  }
  Sentry.nativeCrash();
}
