import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(),
}));

import {
  NativeGoogleSignInUnavailableError,
  createNativeGoogleSignInAdapter,
  shouldUseNativeGoogleSignIn,
} from './nativeGoogleAdapter';

describe('native Google sign-in adapter', () => {
  it('passes the server client ID and nonce to Credential Manager', async () => {
    const signInWithGoogle = vi.fn().mockResolvedValue('signed-google-id-token');
    const adapter = createNativeGoogleSignInAdapter(async () => ({ signInWithGoogle }));

    await expect(adapter.isAvailable()).resolves.toBe(true);
    await expect(adapter.signIn('web-client-id', 'server-nonce')).resolves.toEqual({
      status: 'success',
      idToken: 'signed-google-id-token',
    });
    expect(signInWithGoogle).toHaveBeenCalledWith('web-client-id', 'server-nonce');
  });

  it('reports a missing native module without opening a browser fallback', async () => {
    const adapter = createNativeGoogleSignInAdapter(async () => null);

    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.signIn('web-client-id', 'server-nonce')).rejects.toBeInstanceOf(
      NativeGoogleSignInUnavailableError,
    );
  });

  it('treats an older native module without Google sign-in as unavailable', async () => {
    const adapter = createNativeGoogleSignInAdapter(async () => ({}));

    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.signIn('web-client-id', 'server-nonce')).rejects.toBeInstanceOf(
      NativeGoogleSignInUnavailableError,
    );
  });

  it('rejects an empty ID token', async () => {
    const adapter = createNativeGoogleSignInAdapter(async () => ({
      signInWithGoogle: async () => '',
    }));

    await expect(adapter.signIn('web-client-id', 'server-nonce')).rejects.toThrow(
      'Google sign-in returned an empty ID token.',
    );
  });

  it.each([
    'ERR_GOOGLE_SIGN_IN_CANCELLED',
    'ERR_GOOGLE_SIGN_IN_UNAVAILABLE',
  ])('treats %s as a cancelled account selection', async (code) => {
    const adapter = createNativeGoogleSignInAdapter(async () => ({
      signInWithGoogle: async () => {
        throw Object.assign(new Error('not completed'), { code });
      },
    }));

    await expect(adapter.signIn('web-client-id', 'server-nonce')).resolves.toEqual({
      status: 'cancelled',
    });
  });
});

describe('native Google sign-in selection', () => {
  it('uses Credential Manager only for hosted Google sign-in on Android', () => {
    expect(shouldUseNativeGoogleSignIn(
      'google',
      'https://app.billmanager.app/api/v2',
      'android',
    )).toBe(true);
    expect(shouldUseNativeGoogleSignIn(
      'google',
      '  https://app.billmanager.app/  ',
      'android',
    )).toBe(true);
    expect(shouldUseNativeGoogleSignIn(
      'google',
      'https://app.billmanager.app/api/v2/',
      'android',
    )).toBe(true);
    expect(shouldUseNativeGoogleSignIn(
      'microsoft',
      'https://app.billmanager.app/api/v2',
      'android',
    )).toBe(false);
    expect(shouldUseNativeGoogleSignIn(
      'google',
      'https://self-hosted.example/api/v2',
      'android',
    )).toBe(false);
    expect(shouldUseNativeGoogleSignIn(
      'google',
      'https://app.billmanager.app/api/v2',
      'ios',
    )).toBe(false);
  });
});
