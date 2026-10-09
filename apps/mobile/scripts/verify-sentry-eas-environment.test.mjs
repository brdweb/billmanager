import { describe, expect, it, vi } from 'vitest';

import {
  fetchSentryEasEnvironmentMetadata,
  REQUIRED_SENTRY_VARIABLES,
  verifySentryEasEnvironmentMetadata,
} from './verify-sentry-eas-environment.mjs';

describe('verifySentryEasEnvironmentMetadata', () => {
  it('accepts the required names and returns only visibility metadata', () => {
    const result = verifySentryEasEnvironmentMetadata([
      {
        name: 'SENTRY_DSN',
        visibility: 'SENSITIVE',
        value: 'https://public@example.invalid/42',
      },
      {
        name: 'SENTRY_AUTH_TOKEN',
        visibility: 'SECRET',
        value: 'secret-token-that-must-not-be-logged',
      },
    ]);

    expect(result).toEqual([
      { name: 'SENTRY_DSN', visibility: 'SENSITIVE' },
      { name: 'SENTRY_AUTH_TOKEN', visibility: 'SECRET' },
    ]);
    expect(JSON.stringify(result)).not.toContain('public@example.invalid');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('reports only the missing variable names', () => {
    expect(() => verifySentryEasEnvironmentMetadata([
      { name: 'SENTRY_DSN', visibility: 'SENSITIVE' },
    ])).toThrow(
      'Missing required EAS environment variable names: SENTRY_AUTH_TOKEN',
    );
  });

  it.each(['PUBLIC', 'SECRET', undefined])('rejects unsafe DSN visibility (%s)', (visibility) => {
    expect(() => verifySentryEasEnvironmentMetadata([
      { name: 'SENTRY_DSN', visibility },
      { name: 'SENTRY_AUTH_TOKEN', visibility: 'SECRET' },
    ])).toThrow('SENTRY_DSN must use EAS SENSITIVE visibility.');
  });

  it('requires secret visibility for the upload token', () => {
    expect(() => verifySentryEasEnvironmentMetadata([
      { name: 'SENTRY_DSN', visibility: 'SENSITIVE' },
      { name: 'SENTRY_AUTH_TOKEN', visibility: 'SENSITIVE' },
    ])).toThrow('SENTRY_AUTH_TOKEN must use EAS SECRET visibility.');
  });

  it.each(['preview', 'production'])('requests only names and visibility from Expo (%s)', async (environment) => {
    const requests = [];
    const result = await fetchSentryEasEnvironmentMetadata({
      environment,
      expoToken: 'synthetic-expo-token',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              app: {
                byId: {
                  environmentVariables: [
                    { name: 'SENTRY_DSN', visibility: 'SENSITIVE' },
                    { name: 'SENTRY_AUTH_TOKEN', visibility: 'SECRET' },
                  ],
                },
              },
            },
          }),
        };
      },
    });

    expect(result.map(({ name }) => name)).toEqual(REQUIRED_SENTRY_VARIABLES);
    expect(requests).toHaveLength(1);
    const requestBody = JSON.parse(requests[0].options.body);
    expect(requests[0].url).toBe('https://api.expo.dev/graphql');
    expect(requests[0].options.headers.authorization).toBe('Bearer synthetic-expo-token');
    expect(requestBody.variables).toEqual({
      appId: '061766ea-b874-4027-bcbb-a24b395cb8b6',
      environment,
      filterNames: REQUIRED_SENTRY_VARIABLES,
    });
    expect(requestBody.query).toContain('name');
    expect(requestBody.query).toContain('visibility');
    expect(requestBody.query).not.toMatch(/\bvalue\b/u);
  });

  it('rejects unsupported environments before requesting Expo metadata', async () => {
    const fetchImpl = vi.fn();

    await expect(fetchSentryEasEnvironmentMetadata({
      environment: 'staging',
      expoToken: 'synthetic-expo-token',
      fetchImpl,
    })).rejects.toThrow('Unsupported EAS environment: staging.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
