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
  createOAuthReturnUrl,
  expoOAuthBrowserAdapter,
  parseOAuthRedirect,
  resolveOAuthRedirectUri,
  shouldHandleOAuthUrlWithNavigation,
  supportsOAuthRedirectUri,
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

describe('OAuth sign-in sheet return', () => {
  const hosted = 'https://app.billmanager.app/auth/callback';

  it('asks iOS to return an https callback to the app', async () => {
    browserMocks.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: `${hosted}?code=abc&state=expected`,
    });

    await expect(expoOAuthBrowserAdapter.authorize(
      'https://accounts.google.com/o/oauth2/v2/auth',
      'expected',
      hosted,
      'google',
    )).resolves.toMatchObject({ status: 'success', code: 'abc' });
    expect(browserMocks.openAuthSessionAsync).toHaveBeenLastCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth',
      hosted,
      { preferUniversalLinks: true },
    );
  });

  it('keeps the scheme callback for self-hosted servers', async () => {
    browserMocks.openAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel' });

    await expoOAuthBrowserAdapter.authorize(
      'https://identity.example/authorize',
      'expected',
      'billmanager://auth/callback',
      'oidc',
    );
    expect(browserMocks.openAuthSessionAsync).toHaveBeenLastCalledWith(
      'https://identity.example/authorize',
      'billmanager://auth/callback',
      undefined,
    );
  });

  it('waits for the forwarded address when Apple posts its answer on iOS', () => {
    expect(createOAuthReturnUrl('apple', hosted, 'ios')).toBe(`${hosted}/complete`);
    expect(createOAuthReturnUrl('google', hosted, 'ios')).toBe(hosted);
    expect(createOAuthReturnUrl('apple', hosted, 'android')).toBe(hosted);
    expect(createOAuthReturnUrl('apple', 'billmanager://auth/callback', 'ios'))
      .toBe('billmanager://auth/callback');
  });

  it('reports a sheet that could not start instead of rejecting', async () => {
    browserMocks.openAuthSessionAsync.mockRejectedValueOnce(new Error('failed to start'));

    await expect(expoOAuthBrowserAdapter.authorize(
      'https://accounts.google.com/o/oauth2/v2/auth',
      'expected',
      hosted,
      'google',
    )).resolves.toEqual({
      status: 'error',
      message: 'Authorization did not return to BillManager.',
    });
    expect(shouldHandleOAuthUrlWithNavigation(`${hosted}?code=abc&state=expected`)).toBe(true);
  });

  it('requires iOS 17.4 for an https callback', () => {
    expect(supportsOAuthRedirectUri(hosted, 'ios', '17.3.1')).toBe(false);
    expect(supportsOAuthRedirectUri(hosted, 'ios', '16.4')).toBe(false);
    expect(supportsOAuthRedirectUri(hosted, 'ios', '17.4')).toBe(true);
    expect(supportsOAuthRedirectUri(hosted, 'ios', '27.2.1')).toBe(true);
    expect(supportsOAuthRedirectUri(hosted, 'android', 36)).toBe(true);
    expect(supportsOAuthRedirectUri('billmanager://auth/callback', 'ios', '16.4')).toBe(true);
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
