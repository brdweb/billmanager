import type { ApiResponse } from '../../types';
import type {
  AuthFlowResult,
  AuthSessionScope,
  NativeGoogleAuthorization,
  NativeGoogleCallbackParameters,
} from './types';
import {
  shouldUseNativeGoogleSignIn,
  type NativeGoogleSignInAdapter,
} from './nativeGoogleAdapter';

export interface NativeGoogleAuthorizationClient {
  startNativeGoogleAuthorization(
    flow: 'login' | 'link',
    scope: AuthSessionScope,
  ): Promise<ApiResponse<NativeGoogleAuthorization>>;
  completeNativeGoogleAuthorization(
    input: NativeGoogleCallbackParameters,
    scope: AuthSessionScope,
  ): Promise<AuthFlowResult>;
  discardOAuthTransaction(state: string): Promise<void>;
}

export type NativeGoogleFlowResult =
  | { status: 'completed'; result: AuthFlowResult }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error' };

export async function runNativeGoogleAuthorization(
  client: NativeGoogleAuthorizationClient,
  adapter: NativeGoogleSignInAdapter,
  flow: 'login' | 'link',
  scope: AuthSessionScope,
): Promise<NativeGoogleFlowResult> {
  if (!await adapter.isAvailable()) return { status: 'unavailable' };

  const authorization = await client.startNativeGoogleAuthorization(flow, scope);
  const { client_id: clientId, nonce, state } = authorization.data ?? {};
  if (!authorization.success || !clientId || !nonce || !state) {
    if (state) await client.discardOAuthTransaction(state);
    return { status: 'error' };
  }

  let credential: Awaited<ReturnType<NativeGoogleSignInAdapter['signIn']>>;
  try {
    credential = await adapter.signIn(clientId, nonce);
  } catch (error) {
    await client.discardOAuthTransaction(state);
    throw error;
  }
  if (credential.status === 'cancelled') {
    await client.discardOAuthTransaction(state);
    return credential;
  }

  return {
    status: 'completed',
    result: await client.completeNativeGoogleAuthorization({
      idToken: credential.idToken,
      state,
    }, scope),
  };
}

export function runSelectedOAuthAuthorization<T>(
  providerId: string,
  apiBaseUrl: string,
  platform: string,
  nativeGoogle: () => Promise<T>,
  browser: () => Promise<T>,
): Promise<T> {
  return shouldUseNativeGoogleSignIn(providerId, apiBaseUrl, platform)
    ? nativeGoogle()
    : browser();
}
