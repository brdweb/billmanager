import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';

import { createSentryOptions } from './sentryPrivacy';

type MobileExtra = {
  releaseVersion?: unknown;
  sentryDsn?: unknown;
};

function configuredExtra(): MobileExtra {
  return (Constants.expoConfig?.extra ?? {}) as MobileExtra;
}

function runtimeEnvironment(): string {
  if (Updates.channel) return Updates.channel;
  return __DEV__ ? 'development' : 'production';
}

/**
 * Initialize once, before the root component is registered. No DSN means no
 * client and no network traffic; all other privacy behavior is fixed in code.
 */
export function initializeSentry(): boolean {
  const extra = configuredExtra();
  const dsn = typeof extra.sentryDsn === 'string' ? extra.sentryDsn.trim() : '';
  const releaseVersion =
    typeof extra.releaseVersion === 'string' ? extra.releaseVersion.trim() : '';
  const nativeBuildVersion = Application.nativeBuildVersion?.trim() ?? '';

  if (!dsn) return false;
  if (!releaseVersion || !nativeBuildVersion) {
    // Fail closed: a client without exact release/build identity cannot be
    // associated with its uploaded source maps or release-health sessions.
    return false;
  }

  Sentry.init(createSentryOptions({
    dsn,
    releaseVersion,
    nativeBuildVersion,
    platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web',
    environment: runtimeEnvironment(),
  }));
  return true;
}
