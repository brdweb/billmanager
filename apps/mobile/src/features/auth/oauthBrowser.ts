import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import type { OAuthBrowserResult } from './types';

WebBrowser.maybeCompleteAuthSession();

const CLOUD_API_BASE_URL = 'https://app.billmanager.app/api/v2';
const CLOUD_OAUTH_REDIRECT_URI = 'https://app.billmanager.app/auth/callback';
const CLOUD_OAUTH_FORM_POST_RETURN_URI = `${CLOUD_OAUTH_REDIRECT_URI}/complete`;
let activeOAuthSession: { returnUrl: string; expectedState: string } | null = null;

export interface OAuthBrowserAdapter {
  createRedirectUri(provider: string, apiBaseUrl: string): string;
  authorize(
    authorizationUrl: string,
    expectedState: string,
    redirectUri?: string,
    provider?: string,
  ): Promise<OAuthBrowserResult>;
}

export function createOAuthRedirectUri(
  provider: string,
  apiBaseUrl: string,
  platform: string = Platform.OS,
): string {
  if (platform !== 'web' && apiBaseUrl === CLOUD_API_BASE_URL) {
    return CLOUD_OAUTH_REDIRECT_URI;
  }
  return Linking.createURL('auth/callback');
}

/**
 * The iOS sign-in sheet can return to an https address only from iOS 17.4.
 * Earlier versions leave the hosted callback page open inside the sheet.
 */
export function supportsOAuthRedirectUri(
  redirectUri: string,
  platform: string = Platform.OS,
  version: string | number | undefined = Platform.Version,
): boolean {
  if (platform !== 'ios' || !redirectUri.startsWith('https://')) return true;
  const [major = 0, minor = 0] = String(version ?? '').split('.').map(Number);
  return major > 17 || (major === 17 && minor >= 4);
}

/**
 * The address the sign-in sheet waits for. Apple answers with a form POST to
 * the registered redirect URI, and the iOS sheet matches its return address by
 * URL alone, so it would stop at that POST and drop the posted code. The server
 * forwards that POST to this separate GET address for the app's own sign-ins.
 */
export function createOAuthReturnUrl(
  provider: string | undefined,
  redirectUri: string,
  platform: string = Platform.OS,
): string {
  if (platform === 'ios' && provider === 'apple' && redirectUri === CLOUD_OAUTH_REDIRECT_URI) {
    return CLOUD_OAUTH_FORM_POST_RETURN_URI;
  }
  return redirectUri;
}

export function resolveOAuthRedirectUri(
  requestedRedirectUri: string,
  authorizedRedirectUri?: string,
): string | null {
  if (
    requestedRedirectUri === CLOUD_OAUTH_REDIRECT_URI
    && authorizedRedirectUri !== requestedRedirectUri
  ) {
    return null;
  }
  if (authorizedRedirectUri && authorizedRedirectUri !== requestedRedirectUri) {
    return null;
  }
  return authorizedRedirectUri ?? requestedRedirectUri;
}

/**
 * Expo's Android auth-session polyfill and React Navigation both subscribe to
 * incoming links. Let the active auth session consume its callback so the
 * navigation callback screen cannot race the same authorization code.
 */
export function shouldHandleOAuthUrlWithNavigation(url: string): boolean {
  if (!activeOAuthSession) return true;
  try {
    const incoming = new URL(url);
    const expected = new URL(activeOAuthSession.returnUrl);
    const matchesCallback = incoming.protocol === expected.protocol
      && incoming.host === expected.host
      && incoming.pathname === expected.pathname;
    const matchesState = incoming.searchParams.get('state') === activeOAuthSession.expectedState;
    return !(matchesCallback && matchesState);
  } catch {
    return true;
  }
}

export function parseOAuthRedirect(
  redirectUrl: string,
  expectedState: string,
): OAuthBrowserResult {
  try {
    const parsed = new URL(redirectUrl);
    const returnedState = parsed.searchParams.get('state');
    if (returnedState !== expectedState) {
      return { status: 'error', message: 'The authorization response could not be verified.' };
    }
    const error = parsed.searchParams.get('error');
    if (error) {
      return {
        status: 'error',
        message: parsed.searchParams.get('error_description') ?? 'Authorization was not completed.',
      };
    }

    const code = parsed.searchParams.get('code');
    const provider = parsed.searchParams.get('provider') ?? undefined;
    if (!code) {
      return { status: 'error', message: 'The authorization response was incomplete.' };
    }
    return { status: 'success', code, state: returnedState, provider };
  } catch {
    return { status: 'error', message: 'The authorization response was invalid.' };
  }
}

export const expoOAuthBrowserAdapter: OAuthBrowserAdapter = {
  createRedirectUri: createOAuthRedirectUri,
  authorize: async (authorizationUrl, expectedState, redirectUri, provider) => {
    const returnUrl = createOAuthReturnUrl(
      provider,
      redirectUri ?? Linking.createURL('auth/callback'),
    );
    activeOAuthSession = { returnUrl, expectedState };
    let result: Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;
    try {
      // Without preferUniversalLinks, iOS treats "https" as a custom scheme and
      // the sheet never returns to the app.
      result = await WebBrowser.openAuthSessionAsync(
        authorizationUrl,
        returnUrl,
        returnUrl.startsWith('https://') ? { preferUniversalLinks: true } : undefined,
      );
    } catch {
      return { status: 'error', message: 'Authorization did not return to BillManager.' };
    } finally {
      activeOAuthSession = null;
    }
    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { status: 'cancelled' };
    }
    if (result.type !== 'success' || !result.url) {
      return { status: 'error', message: 'Authorization did not return to BillManager.' };
    }
    return parseOAuthRedirect(result.url, expectedState);
  },
};
