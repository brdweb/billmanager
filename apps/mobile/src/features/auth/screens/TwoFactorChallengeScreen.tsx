import React, { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { api as defaultApi, BillManagerApi } from '../../../api/client';
import type { ServerCapabilities } from '../../../domain/serverProfile';
import {
  passkeyAvailability,
  type PasskeyCeremonyAdapter,
  nativePasskeyAdapter,
} from '../../security/passkeyAdapter';
import type { AuthFlowResult, AuthSessionScope, TwoFactorMethod } from '../types';
import {
  recoveryCodeSchema,
  sixDigitCodeSchema,
  validationErrors,
} from '../validation';
import {
  ActionButton,
  AuthScaffold,
  FormField,
  StatusNotice,
} from '../components/AuthSurface';

export interface TwoFactorChallengeScreenProps {
  client?: BillManagerApi;
  sessionToken: string;
  methods: TwoFactorMethod[];
  authScope: AuthSessionScope;
  capabilities?: ServerCapabilities | null;
  passkeyAdapter?: PasskeyCeremonyAdapter;
  onAuthenticated: (result: Extract<AuthFlowResult, { status: 'authenticated' }>) => void;
  onCancel?: () => void;
}

export function TwoFactorChallengeScreen({
  client = defaultApi,
  sessionToken,
  methods,
  authScope,
  capabilities: override,
  passkeyAdapter = nativePasskeyAdapter,
  onAuthenticated,
  onCancel,
}: TwoFactorChallengeScreenProps) {
  const { t } = useTranslation();
  const capabilities = override === undefined ? client.getActiveProfile().capabilities : override;
  const methodLabels: Record<TwoFactorMethod, string> = {
    email_otp: t('mobileAuth.twoFactor.email'),
    passkey: t('mobileAuth.twoFactor.passkey'),
    recovery: t('mobileAuth.twoFactor.recovery'),
  };
  const availableMethods = useMemo(
    () => methods.filter((method) => {
      if (method === 'email_otp') return capabilities?.emailOtp !== false;
      if (method === 'passkey') return capabilities?.passkeys !== false;
      return true;
    }),
    [capabilities?.emailOtp, capabilities?.passkeys, methods],
  );
  const [method, setMethod] = useState<TwoFactorMethod>(availableMethods[0] ?? 'recovery');
  const [notice, setNotice] = useState<{ kind: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [passkeyReady, setPasskeyReady] = useState(false);
  const emailForm = useForm<z.input<typeof sixDigitCodeSchema>>({ defaultValues: { code: '' } });
  const recoveryForm = useForm<z.input<typeof recoveryCodeSchema>>({ defaultValues: { recoveryCode: '' } });

  useEffect(() => {
    let active = true;
    const serverSupportsPasskeys = capabilities?.passkeys ?? methods.includes('passkey');
    void passkeyAvailability(passkeyAdapter, serverSupportsPasskeys).then((availability) => {
      if (!active) return;
      setPasskeyReady(availability.available);
      if (method === 'passkey' && !availability.available) {
        setNotice({ kind: 'info', message: t('mobileAuth.twoFactor.passkeyBuildUnavailable') });
      }
    });
    return () => {
      active = false;
    };
  }, [capabilities?.passkeys, method, methods, passkeyAdapter]);

  const complete = async (selectedMethod: TwoFactorMethod, payload: Record<string, unknown>) => {
    setWorking(true);
    setNotice(null);
    const response = await client.verifyTwoFactor(
      sessionToken,
      selectedMethod,
      payload,
      authScope,
    );
    setWorking(false);
    if (!response.success || !response.data) {
      setNotice({ kind: 'error', message: response.error ?? t('mobileAuth.twoFactor.verificationFailed') });
      return;
    }
    onAuthenticated({
      status: 'authenticated',
      session: response.data,
      scope: response.scope ?? authScope,
    });
  };

  const sendEmailCode = async () => {
    setWorking(true);
    setNotice(null);
    const response = await client.requestTwoFactorChallenge(
      sessionToken,
      'email_otp',
      authScope,
    );
    setWorking(false);
    setNotice(response.success
      ? { kind: 'success', message: response.data?.message ?? t('mobileAuth.twoFactor.codeSent') }
      : { kind: 'error', message: response.error ?? t('mobileAuth.twoFactor.codeSendFailed') });
  };

  const verifyEmail = emailForm.handleSubmit(async (values) => {
    const parsed = sixDigitCodeSchema.safeParse(values);
    if (!parsed.success) {
      const errors = validationErrors(sixDigitCodeSchema, values);
      if (errors.code) emailForm.setError('code', { message: t('mobileAuth.validation.code') });
      return;
    }
    await complete('email_otp', { code: parsed.data.code });
  });

  const verifyRecovery = recoveryForm.handleSubmit(async (values) => {
    const parsed = recoveryCodeSchema.safeParse(values);
    if (!parsed.success) {
      const errors = validationErrors(recoveryCodeSchema, values);
      if (errors.recoveryCode) recoveryForm.setError('recoveryCode', { message: t('mobileAuth.validation.recoveryCode') });
      return;
    }
    await complete('recovery', { recovery_code: parsed.data.recoveryCode });
  });

  const verifyPasskey = async () => {
    if (!passkeyReady) {
      setNotice({ kind: 'info', message: t('mobileAuth.twoFactor.nativeUnavailable') });
      return;
    }
    setWorking(true);
    setNotice(null);
    const options = await client.getPasskeyAuthenticationOptions(sessionToken, authScope);
    if (!options.success || !options.data) {
      setWorking(false);
      setNotice({ kind: 'error', message: options.error ?? t('mobileAuth.twoFactor.optionsFailed') });
      return;
    }
    try {
      const credential = await passkeyAdapter.getCredential(options.data.options);
      await complete('passkey', { credential });
    } catch (error) {
      setWorking(false);
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : t('mobileAuth.twoFactor.passkeyCancelled'),
      });
    }
  };

  return (
    <AuthScaffold
      title={t('mobileAuth.twoFactor.title')}
      subtitle={t('mobileAuth.twoFactor.subtitle')}
      footer={onCancel ? <ActionButton label={t('mobileAuth.twoFactor.cancel')} variant="plain" onPress={onCancel} /> : undefined}
      testID="auth-two-factor-screen"
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {availableMethods.map((candidate) => (
          <ActionButton
            key={candidate}
            label={methodLabels[candidate]}
            variant={method === candidate ? 'primary' : 'secondary'}
            onPress={() => {
              setMethod(candidate);
              setNotice(null);
            }}
          />
        ))}
      </View>
      {notice ? <StatusNotice kind={notice.kind} message={notice.message} /> : null}
      {method === 'email_otp' ? (
        <>
          <ActionButton label={t('mobileAuth.twoFactor.sendEmail')} variant="secondary" loading={working} onPress={sendEmailCode} />
          <Controller
            control={emailForm.control}
            name="code"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormField
                label={t('mobileAuth.common.sixDigitCode')}
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={emailForm.formState.errors.code?.message}
                autoComplete="one-time-code"
                keyboardType="number-pad"
                maxLength={6}
                onSubmitEditing={() => { void verifyEmail(); }}
              />
            )}
          />
          <ActionButton label={t('mobileAuth.twoFactor.verifyCode')} loading={working} onPress={verifyEmail} />
        </>
      ) : null}
      {method === 'passkey' ? (
        <>
          {!passkeyReady ? (
            <StatusNotice
              kind="info"
              message={t('mobileAuth.twoFactor.passkeyBuildUnavailable')}
            />
          ) : null}
          <ActionButton
            label={t('mobileAuth.twoFactor.usePasskey')}
            loading={working}
            disabled={!passkeyReady}
            onPress={verifyPasskey}
          />
        </>
      ) : null}
      {method === 'recovery' ? (
        <>
          <Controller
            control={recoveryForm.control}
            name="recoveryCode"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormField
                label={t('mobileAuth.common.recoveryCode')}
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={recoveryForm.formState.errors.recoveryCode?.message}
                autoCapitalize="characters"
                autoCorrect={false}
                onSubmitEditing={() => { void verifyRecovery(); }}
              />
            )}
          />
          <ActionButton label={t('mobileAuth.twoFactor.useRecovery')} loading={working} onPress={verifyRecovery} />
        </>
      ) : null}
      {availableMethods.length === 0 ? (
        <StatusNotice kind="error" message={t('mobileAuth.twoFactor.noMethods')} />
      ) : null}
    </AuthScaffold>
  );
}
