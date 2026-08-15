import { describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  openAuthSessionAsync: vi.fn(),
}));

vi.mock('expo-linking', () => ({ createURL: vi.fn(() => 'billmanager://auth/callback') }));
vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: browserMocks.openAuthSessionAsync,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import {
  createOAuthRedirectUri,
  expoOAuthBrowserAdapter,
  parseOAuthRedirect,
  resolveOAuthRedirectUri,
  shouldHandleOAuthUrlWithNavigation,
} from './oauthBrowser';

describe('OAuth redirect selection', () => {
  it('uses the verified HTTPS app link for hosted Google sign-in on Android', () => {
    expect(createOAuthRedirectUri(
      'google',
      'https://app.billmanager.app/api/v2',
      'android',
    )).toBe('https://app.billmanager.app/auth/callback');
  });

  it('uses the verified HTTPS app link for all hosted Android providers', () => {
    expect(createOAuthRedirectUri(
      'microsoft',
      'https://app.billmanager.app/api/v2',
      'android',
    )).toBe('https://app.billmanager.app/auth/callback');
  });

  it('keeps the app scheme for self-hosted servers and uses the app link on iOS', () => {
    expect(createOAuthRedirectUri('google', 'https://bills.example/api/v2', 'android'))
      .toBe('billmanager://auth/callback');
    expect(createOAuthRedirectUri(
      'google',
      'https://app.billmanager.app/api/v2',
      'ios',
    )).toBe('https://app.billmanager.app/auth/callback');
  });

  it('rejects a redirect URI changed by the authorization server', () => {
    expect(resolveOAuthRedirectUri(
      'https://app.billmanager.app/auth/callback',
      'https://attacker.example/callback',
    )).toBeNull();
    expect(resolveOAuthRedirectUri(
      'https://app.billmanager.app/auth/callback',
      'https://app.billmanager.app/auth/callback',
    )).toBe('https://app.billmanager.app/auth/callback');
    expect(resolveOAuthRedirectUri(
      'https://app.billmanager.app/auth/callback',
    )).toBeNull();
  });

  it('prevents navigation from racing the active Android auth session', async () => {
    let finishAuthorization: ((result: {
      type: 'success';
      url: string;
    }) => void) | undefined;
    browserMocks.openAuthSessionAsync.mockImplementationOnce(() => new Promise((resolve) => {
      finishAuthorization = resolve;
    }));
    const callbackUrl = 'https://app.billmanager.app/auth/callback?code=abc&state=expected';

    const authorization = expoOAuthBrowserAdapter.authorize(
      'https://accounts.google.com/o/oauth2/v2/auth',
      'expected',
      'https://app.billmanager.app/auth/callback',
    );
    expect(shouldHandleOAuthUrlWithNavigation(callbackUrl)).toBe(false);
    expect(shouldHandleOAuthUrlWithNavigation(
      'https://app.billmanager.app/auth/callback?code=abc&state=another-session',
    )).toBe(true);
    expect(shouldHandleOAuthUrlWithNavigation(
      'https://app.billmanager.app/auth/callback-extra?code=abc&state=expected',
    )).toBe(true);

    finishAuthorization?.({ type: 'success', url: callbackUrl });
    await expect(authorization).resolves.toEqual({
      status: 'success',
      code: 'abc',
      state: 'expected',
      provider: undefined,
    });
    expect(shouldHandleOAuthUrlWithNavigation(callbackUrl)).toBe(true);
  });
});

describe('OAuth redirect parsing', () => {
  it('returns a verified authorization code', () => {
    expect(parseOAuthRedirect(
      'billmanager://auth/callback?code=abc&state=expected&provider=google',
      'expected',
    )).toEqual({
      status: 'success',
      code: 'abc',
      state: 'expected',
      provider: 'google',
    });
  });

  it('rejects a mismatched state token', () => {
    expect(parseOAuthRedirect(
      'billmanager://auth/callback?code=abc&state=wrong',
      'expected',
    )).toEqual({
      status: 'error',
      message: 'The authorization response could not be verified.',
    });
  });

  it('preserves a provider error without exposing tokens', () => {
    expect(parseOAuthRedirect(
      'billmanager://auth/callback?error=access_denied&error_description=Cancelled&state=expected',
      'expected',
    )).toEqual({ status: 'error', message: 'Cancelled' });
  });

  it('rejects a provider error without the matching state token', () => {
    expect(parseOAuthRedirect(
      'billmanager://auth/callback?error=access_denied&error_description=Cancelled',
      'expected',
    )).toEqual({
      status: 'error',
      message: 'The authorization response could not be verified.',
    });
  });
});
