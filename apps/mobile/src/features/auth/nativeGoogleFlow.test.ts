import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(),
}));

import {
  runNativeGoogleAuthorization,
  runSelectedOAuthAuthorization,
} from './nativeGoogleFlow';
import { deliverOAuthResult } from './oauthResultDelivery';

const scope = { serverProfileId: 'billmanager-cloud', databaseId: null };

describe('native Google OAuth orchestration', () => {
  it('routes hosted Android Google through start, Credential Manager, and callback only', async () => {
    const events: string[] = [];
    const startNativeGoogleAuthorization = vi.fn(async () => {
      events.push('start');
      return {
        success: true,
        data: { client_id: 'web-client-id', nonce: 'server-nonce', state: 'server-state' },
      };
    });
    const signIn = vi.fn(async () => {
      events.push('credential');
      return { status: 'success' as const, idToken: 'signed-id-token' };
    });
    const completeNativeGoogleAuthorization = vi.fn(async () => {
      events.push('callback');
      return {
        status: 'two_factor_required' as const,
        sessionToken: 'twofa-session',
        methods: ['passkey' as const],
        scope,
      };
    });
    const browser = vi.fn(async () => ({ status: 'error' as const }));

    const outcome = await runSelectedOAuthAuthorization(
      'google',
      'https://app.billmanager.app/',
      'android',
      () => runNativeGoogleAuthorization({
        startNativeGoogleAuthorization,
        completeNativeGoogleAuthorization,
        discardOAuthTransaction: vi.fn(),
      }, {
        isAvailable: async () => true,
        signIn,
      }, 'login', scope),
      browser,
    );

    expect(events).toEqual(['start', 'credential', 'callback']);
    expect(browser).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith('web-client-id', 'server-nonce');
    expect(completeNativeGoogleAuthorization).toHaveBeenCalledWith({
      idToken: 'signed-id-token',
      state: 'server-state',
    }, scope);
    expect(outcome).toEqual({
      status: 'completed',
      result: {
        status: 'two_factor_required',
        sessionToken: 'twofa-session',
        methods: ['passkey'],
        scope,
      },
    });

    const onTwoFactorRequired = vi.fn();
    if (outcome.status !== 'completed') throw new Error('Expected a completed native flow.');
    deliverOAuthResult(
      outcome.result,
      'login',
      { onTwoFactorRequired },
      ((key: string) => key) as never,
    );
    expect(onTwoFactorRequired).toHaveBeenCalledWith(outcome.result);
  });

  it('stops after account selection is cancelled', async () => {
    const completeNativeGoogleAuthorization = vi.fn();
    const discardOAuthTransaction = vi.fn();
    const outcome = await runNativeGoogleAuthorization({
      startNativeGoogleAuthorization: async () => ({
        success: true,
        data: { client_id: 'web-client-id', nonce: 'server-nonce', state: 'server-state' },
      }),
      completeNativeGoogleAuthorization,
      discardOAuthTransaction,
    }, {
      isAvailable: async () => true,
      signIn: async () => ({ status: 'cancelled' }),
    }, 'login', scope);

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(completeNativeGoogleAuthorization).not.toHaveBeenCalled();
    expect(discardOAuthTransaction).toHaveBeenCalledOnce();
    expect(discardOAuthTransaction).toHaveBeenCalledWith('server-state');
  });

  it('keeps other providers on the browser flow', async () => {
    const nativeGoogle = vi.fn();
    const browser = vi.fn(async () => 'browser-result');

    await expect(runSelectedOAuthAuthorization(
      'microsoft',
      'https://app.billmanager.app/api/v2',
      'android',
      nativeGoogle,
      browser,
    )).resolves.toBe('browser-result');
    expect(browser).toHaveBeenCalledOnce();
    expect(nativeGoogle).not.toHaveBeenCalled();
  });
});
