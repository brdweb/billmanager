import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { api as defaultApi, BillManagerApi } from '../../../api/client';
import type { ServerCapabilities } from '../../../domain/serverProfile';
import type { OAuthProvider } from '../types';
import {
  expoOAuthBrowserAdapter,
  resolveOAuthRedirectUri,
  type OAuthBrowserAdapter,
} from '../oauthBrowser';
import {
  nativeGoogleSignInAdapter,
  type NativeGoogleSignInAdapter,
} from '../nativeGoogleAdapter';
import {
  runNativeGoogleAuthorization,
  runSelectedOAuthAuthorization,
} from '../nativeGoogleFlow';
import {
  deliverOAuthResult,
  type OAuthResultCallbacks,
} from '../oauthResultDelivery';
import {
  ActionButton,
  AuthScaffold,
  CapabilityUnavailable,
  LoadingState,
  StatusNotice,
} from '../components/AuthSurface';

export interface OAuthProvidersScreenProps extends OAuthResultCallbacks {
  client?: BillManagerApi;
  capabilities?: ServerCapabilities | null;
  browser?: OAuthBrowserAdapter;
  nativeGoogle?: NativeGoogleSignInAdapter;
  platform?: string;
  flow?: 'login' | 'link';
  onCancel?: () => void;
}

export function OAuthProvidersScreen({
  client = defaultApi,
  capabilities: override,
  browser = expoOAuthBrowserAdapter,
  nativeGoogle = nativeGoogleSignInAdapter,
  platform = Platform.OS,
  flow = 'login',
  onCancel,
  ...callbacks
}: OAuthProvidersScreenProps) {
  const { t } = useTranslation();
  const capabilities = override === undefined ? client.getActiveProfile().capabilities : override;
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if ((capabilities?.oauthProviders.length ?? 0) === 0) return;
    let active = true;
    void client.getOAuthProviders().then((response) => {
      if (!active) return;
      setLoading(false);
      if (response.success && response.data) {
        const allowed = new Set(capabilities?.oauthProviders ?? []);
        setProviders(response.data.filter((provider) => allowed.has(provider.id)));
      } else {
        setNotice(response.error ?? t('mobileAuth.oauth.loadFailed'));
      }
    });
    return () => {
      active = false;
    };
  }, [capabilities?.oauthProviders, client]);

  if ((capabilities?.oauthProviders.length ?? 0) === 0) {
    return (
      <CapabilityUnavailable
        title={flow === 'link' ? t('mobileAuth.oauth.linkTitle') : t('mobileAuth.oauth.signInTitle')}
        message={t('mobileAuth.oauth.unavailable')}
      />
    );
  }

  const authorize = async (provider: OAuthProvider) => {
    const authScope = client.captureAuthSessionScope();
    setActiveProvider(provider.id);
    setNotice(null);
    const requestedRedirectUri = browser.createRedirectUri(provider.id, client.getBaseUrl());
    const authorization = await client.getOAuthAuthorization(
      provider.id,
      flow,
      requestedRedirectUri,
      authScope,
    );
    if (!authorization.success || !authorization.data) {
      setNotice(authorization.error ?? t('mobileAuth.oauth.connectFailed', { provider: provider.display_name }));
      setActiveProvider(null);
      return;
    }
    const redirectUri = resolveOAuthRedirectUri(
      requestedRedirectUri,
      authorization.data.redirect_uri,
    );
    if (!redirectUri) {
      setNotice(t('mobileAuth.oauth.connectFailed', { provider: provider.display_name }));
      setActiveProvider(null);
      return;
    }
    const browserResult = await browser.authorize(
      authorization.data.auth_url,
      authorization.data.state,
      redirectUri,
    );
    if (browserResult.status === 'cancelled') {
      setActiveProvider(null);
      return;
    }
    if (browserResult.status === 'error') {
      setNotice(browserResult.message);
      setActiveProvider(null);
      return;
    }
    const result = await client.completeOAuthCallback(
      {
        provider: provider.id,
        code: browserResult.code,
        state: browserResult.state,
        redirectUri,
      },
      authScope,
    );
    setActiveProvider(null);
    const resultMessage = deliverOAuthResult(result, flow, callbacks, t);
    if (resultMessage) setNotice(resultMessage);
  };

  const authorizeNativeGoogle = async (provider: OAuthProvider) => {
    const authScope = client.captureAuthSessionScope();
    setActiveProvider(provider.id);
    setNotice(null);
    try {
      const outcome = await runNativeGoogleAuthorization(
        client,
        nativeGoogle,
        flow,
        authScope,
      );
      if (outcome.status === 'cancelled') return;
      if (outcome.status !== 'completed') {
        setNotice(t('mobileAuth.oauth.connectFailed', { provider: provider.display_name }));
        return;
      }
      const resultMessage = deliverOAuthResult(outcome.result, flow, callbacks, t);
      if (resultMessage) setNotice(resultMessage);
    } catch {
      setNotice(t('mobileAuth.oauth.connectFailed', { provider: provider.display_name }));
    } finally {
      setActiveProvider(null);
    }
  };

  return (
    <AuthScaffold
      title={flow === 'link' ? t('mobileAuth.oauth.linkTitle') : t('mobileAuth.oauth.signInTitle')}
      subtitle={t('mobileAuth.oauth.subtitle')}
      footer={onCancel ? <ActionButton label={t('mobileAuth.oauth.cancel')} variant="plain" onPress={onCancel} /> : undefined}
      testID="auth-oauth-providers-screen"
    >
      {loading ? <LoadingState label={t('mobileAuth.oauth.loading')} /> : null}
      {notice ? <StatusNotice kind="error" message={notice} /> : null}
      {providers.map((provider) => (
        <ActionButton
          key={provider.id}
          label={t(
            flow === 'link' ? 'mobileAuth.oauth.linkProvider' : 'mobileAuth.oauth.continueProvider',
            { provider: provider.display_name },
          )}
          variant="secondary"
          loading={activeProvider === provider.id}
          disabled={activeProvider !== null && activeProvider !== provider.id}
          onPress={() => void runSelectedOAuthAuthorization(
            provider.id,
            client.getBaseUrl(),
            platform,
            () => authorizeNativeGoogle(provider),
            () => authorize(provider),
          )}
        />
      ))}
      {!loading && providers.length === 0 ? (
        <StatusNotice kind="warning" message={t('mobileAuth.oauth.noneAvailable')} />
      ) : null}
    </AuthScaffold>
  );
}

export interface OAuthCallbackScreenProps extends OAuthResultCallbacks {
  client?: BillManagerApi;
  provider?: string;
  code: string;
  state: string;
  redirectUri?: string;
  flow?: 'login' | 'link';
  onRetry?: () => void;
}

export function OAuthCallbackScreen({
  client = defaultApi,
  provider,
  code,
  state,
  redirectUri,
  flow,
  onRetry,
  onAuthenticated,
  onTwoFactorRequired,
  onLinked,
}: OAuthCallbackScreenProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (!code || !state) {
      setError(t('mobileAuth.oauth.callbackMissing'));
      return;
    }
    started.current = true;
    let active = true;
    void (async () => {
      const transaction = await client.getPendingOAuthTransaction(state);
      const resolvedProvider = provider ?? transaction?.provider;
      if (!resolvedProvider) {
        if (active) setError(t('mobileAuth.oauth.callbackMissing'));
        return;
      }
      const result = await client.completeOAuthCallback({
        provider: resolvedProvider,
        code,
        state,
        redirectUri: redirectUri ?? transaction?.redirectUri,
      });
      if (!active) return;
      const resultMessage = deliverOAuthResult(result, flow ?? transaction?.flow ?? 'login', {
        onAuthenticated,
        onTwoFactorRequired,
        onLinked,
      }, t);
      if (resultMessage) setError(resultMessage);
    })();
    return () => {
      active = false;
    };
  }, [client, code, flow, onAuthenticated, onLinked, onTwoFactorRequired, provider, redirectUri, state]);

  return (
    <AuthScaffold title={t('mobileAuth.oauth.completing')}>
      {error ? (
        <>
          <StatusNotice kind="error" message={error} />
          {onRetry ? <ActionButton label={t('mobileAuth.common.tryAgain')} onPress={onRetry} /> : null}
        </>
      ) : (
        <LoadingState label={t('mobileAuth.oauth.verifying')} />
      )}
    </AuthScaffold>
  );
}
