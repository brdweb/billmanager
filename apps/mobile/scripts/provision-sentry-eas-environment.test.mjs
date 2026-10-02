import { describe, expect, it, vi } from 'vitest';

import {
  provisionSentryEasEnvironment,
  SENTRY_EAS_VARIABLES,
} from './provision-sentry-eas-environment.mjs';

const protectedEnvironment = {
  EXPO_TOKEN: 'synthetic-expo-token',
  SENTRY_DSN: 'https://public@example.invalid/42',
  SENTRY_AUTH_TOKEN: 'synthetic-upload-token',
};

describe('provisionSentryEasEnvironment', () => {
  it('writes both protected values to preview with the required visibility', () => {
    const run = vi.fn(() => ({ status: 0 }));

    const result = provisionSentryEasEnvironment({
      environment: protectedEnvironment,
      run,
    });

    expect(result).toEqual(SENTRY_EAS_VARIABLES);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([, args]) => args)).toEqual([
      expect.arrayContaining([
        'env:create', '--environment', 'preview', '--scope', 'project',
        '--name', 'SENTRY_DSN', '--value', protectedEnvironment.SENTRY_DSN,
        '--visibility', 'sensitive', '--non-interactive', '--force',
      ]),
      expect.arrayContaining([
        'env:create', '--environment', 'preview', '--scope', 'project',
        '--name', 'SENTRY_AUTH_TOKEN', '--value', protectedEnvironment.SENTRY_AUTH_TOKEN,
        '--visibility', 'secret', '--non-interactive', '--force',
      ]),
    ]);
    for (const [, , options] of run.mock.calls) {
      expect(options.stdio).toBe('pipe');
    }
  });

  it.each(['EXPO_TOKEN', 'SENTRY_DSN', 'SENTRY_AUTH_TOKEN'])(
    'fails closed when %s is absent',
    (missingName) => {
      const environment = { ...protectedEnvironment };
      delete environment[missingName];
      const run = vi.fn();

      expect(() => provisionSentryEasEnvironment({ environment, run })).toThrow(
        `Missing protected GitHub environment secret: ${missingName}.`,
      );
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('does not include CLI output or protected values in a failure', () => {
    const run = vi.fn(() => ({
      status: 1,
      stdout: `unexpected ${protectedEnvironment.SENTRY_DSN}`,
      stderr: `unexpected ${protectedEnvironment.SENTRY_AUTH_TOKEN}`,
    }));

    let message = '';
    try {
      provisionSentryEasEnvironment({ environment: protectedEnvironment, run });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('Failed to provision SENTRY_DSN in EAS preview (exit 1).');
    expect(message).not.toContain(protectedEnvironment.SENTRY_DSN);
    expect(message).not.toContain(protectedEnvironment.SENTRY_AUTH_TOKEN);
  });
});
