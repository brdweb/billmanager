import type { TFunction } from 'i18next';

import type { AuthFlowResult } from './types';

export interface OAuthResultCallbacks {
  onAuthenticated?: (result: Extract<AuthFlowResult, { status: 'authenticated' }>) => void;
  onTwoFactorRequired?: (
    result: Extract<AuthFlowResult, { status: 'two_factor_required' }>,
  ) => void;
  onLinked?: () => void;
}

export function deliverOAuthResult(
  result: AuthFlowResult,
  flow: 'login' | 'link',
  callbacks: OAuthResultCallbacks,
  t: TFunction,
): string | null {
  if (result.status === 'linked') {
    callbacks.onLinked?.();
    return null;
  }
  if (result.status === 'authenticated') {
    if (flow === 'link') callbacks.onLinked?.();
    else callbacks.onAuthenticated?.(result);
    return null;
  }
  if (result.status === 'two_factor_required') {
    callbacks.onTwoFactorRequired?.(result);
    return null;
  }
  if (result.status === 'password_change_required') {
    return t('mobileAuth.oauth.passwordChangeRequired');
  }
  if (result.status === 'email_verification_required') return result.message;
  return result.message;
}
