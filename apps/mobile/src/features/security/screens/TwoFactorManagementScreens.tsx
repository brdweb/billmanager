import React, { useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { api as defaultApi, BillManagerApi } from '../../../api/client';
import type { ServerCapabilities } from '../../../domain/serverProfile';
import { typography } from '../../../design/tokens';
import { useAdaptiveTheme } from '../../../design/useAdaptiveTheme';
import {
  ActionButton,
  AuthScaffold,
  CapabilityUnavailable,
  FormField,
  ListAction,
  LoadingState,
  Section,
  StatusNotice,
} from '../../auth/components/AuthSurface';
import { sixDigitCodeSchema, validationErrors } from '../../auth/validation';
import {
  passkeyAvailability,
  type PasskeyCeremonyAdapter,
  nativePasskeyAdapter,
} from '../passkeyAdapter';
import type { PasskeySummary } from '../types';

const deviceNameSchema = z.object({
  deviceName: z.string().trim().min(2, 'Enter a name for this passkey').max(80),
});

const confirmationSchema = z.object({
  confirmation: z.string().min(1, 'Enter your password or confirmation code'),
});

function RecoveryCodesPanel({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme();
  const share = async () => {
    await Share.share({
      title: t('mobileSecurity.recovery.shareTitle'),
      message: t('mobileSecurity.recovery.shareMessage', { codes: codes.join('\n') }),
    });
  };

  return (
    <Section
      title={t('mobileSecurity.recovery.panelTitle')}
      description={t('mobileSecurity.recovery.panelDescription')}
    >
      <View
        accessible
        accessibilityLabel={t('mobileSecurity.recovery.accessibility', { codes: codes.join(', ') })}
        style={{
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: theme.radius.small,
          padding: theme.spacing.md,
          gap: theme.spacing.xs,
        }}
      >
        {codes.map((code) => (
          <Text key={code} selectable style={[typography.headline, { color: theme.colors.text, letterSpacing: 1.4 }]}>
            {code}
          </Text>
        ))}
      </View>
      <ActionButton label={t('mobileSecurity.recovery.share')} variant="secondary" onPress={() => void share()} />
    </Section>
  );
}

export interface EmailTwoFactorSetupScreenProps {
  client?: BillManagerApi;
  capabilities?: ServerCapabilities | null;
  onComplete?: (recoveryCodes: string[] | null) => void;
}

export function EmailTwoFactorSetupScreen({
  client = defaultApi,
  capabilities: override,
  onComplete,
}: EmailTwoFactorSetupScreenProps) {
  const { t } = useTranslation();
  const capabilities = override === undefined ? client.getActiveProfile().capabilities : override;
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const form = useForm<z.input<typeof sixDigitCodeSchema>>({ defaultValues: { code: '' } });

  if (!capabilities?.emailOtp) {
    return (
      <CapabilityUnavailable
        title={t('mobileSecurity.emailSetup.title')}
        message={t('mobileSecurity.emailSetup.unavailable')}
      />
    );
  }

  const sendCode = async () => {
    setWorking(true);
    setNotice(null);
    const response = await client.beginEmailTwoFactorSetup();
    setWorking(false);
    if (!response.success || !response.data) {
      setNotice({ kind: 'error', message: response.error ?? t('mobileSecurity.emailSetup.sendFailed') });
      return;
    }
    setSetupToken(response.data.setup_token);
    setNotice({ kind: 'success', message: response.data.message });
  };

  const confirm = form.handleSubmit(async (values) => {
    const parsed = sixDigitCodeSchema.safeParse(values);
    if (!parsed.success) {
      const errors = validationErrors(sixDigitCodeSchema, values);
      if (errors.code) form.setError('code', { message: t('mobileAuth.validation.code') });
      return;
    }
    if (!setupToken) return;
    setWorking(true);
    setNotice(null);
    const response = await client.confirmEmailTwoFactorSetup(setupToken, parsed.data.code);
    setWorking(false);
    if (!response.success || !response.data) {
      setNotice({ kind: 'error', message: response.error ?? t('mobileSecurity.emailSetup.verifyFailed') });
      return;
    }
    setNotice({ kind: 'success', message: response.data.message });
    setRecoveryCodes(response.data.recovery_codes);
    onComplete?.(response.data.recovery_codes);
  });

  return (
    <AuthScaffold
      title={t('mobileSecurity.emailSetup.title')}
      subtitle={t('mobileSecurity.emailSetup.subtitle')}
      testID="security-email-two-factor-setup-screen"
    >
      {notice ? <StatusNotice kind={notice.kind} message={notice.message} /> : null}
      {!setupToken ? (
        <ActionButton label={t('mobileSecurity.emailSetup.send')} loading={working} onPress={sendCode} />
      ) : (
        <>
          <Controller
            control={form.control}
            name="code"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormField
                label={t('mobileSecurity.common.sixDigitCode')}
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={form.formState.errors.code?.message}
                autoComplete="one-time-code"
                keyboardType="number-pad"
                maxLength={6}
                onSubmitEditing={() => { void confirm(); }}
              />
            )}
          />
          <ActionButton label={t('mobileSecurity.emailSetup.verify')} loading={working} onPress={confirm} />
          <ActionButton label={t('mobileSecurity.emailSetup.resend')} variant="plain" disabled={working} onPress={sendCode} />
        </>
      )}
      {recoveryCodes?.length ? <RecoveryCodesPanel codes={recoveryCodes} /> : null}
    </AuthScaffold>
  );
}

export interface PasskeyManagementScreenProps {
  client?: BillManagerApi;
  capabilities?: ServerCapabilities | null;
  adapter?: PasskeyCeremonyAdapter;
  hasPassword: boolean;
  onRecoveryCodes?: (codes: string[]) => void;
}

export function PasskeyManagementScreen({
  client = defaultApi,
  capabilities: override,
  adapter = nativePasskeyAdapter,
  hasPassword,
  onRecoveryCodes,
}: PasskeyManagementScreenProps) {
  const { t, i18n } = useTranslation();
  const capabilities = override === undefined ? client.getActiveProfile().capabilities : override;
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PasskeySummary | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const deviceForm = useForm<z.input<typeof deviceNameSchema>>({
    defaultValues: { deviceName: t('mobileSecurity.passkeys.defaultDevice') },
  });
  const confirmationForm = useForm<z.input<typeof confirmationSchema>>({
    defaultValues: { confirmation: '' },
  });

  const load = async () => {
    setLoading(true);
    const response = await client.listPasskeys();
    setLoading(false);
    if (response.success && response.data) setPasskeys(response.data);
    else setNotice({ kind: 'error', message: response.error ?? t('mobileSecurity.passkeys.loadFailed') });
  };

  useEffect(() => {
    if (!capabilities?.passkeys) return;
    void load();
    void passkeyAvailability(adapter, true).then((availability) => {
      setNativeReady(availability.available);
      if (!availability.available) {
        setNotice({ kind: 'info', message: t('mobileSecurity.passkeys.nativeUnavailable') });
      }
    });
  }, [adapter, capabilities?.passkeys]);

  if (!capabilities?.passkeys) {
    return (
      <CapabilityUnavailable
        title={t('mobileSecurity.passkeys.title')}
        message={t('mobileSecurity.passkeys.unavailable')}
      />
    );
  }

  const addPasskey = deviceForm.handleSubmit(async (values) => {
    const parsed = deviceNameSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      deviceForm.setError('deviceName', { message: t('mobileSecurity.passkeys.nameRequired') });
      return;
    }
    if (!nativeReady) {
      setNotice({ kind: 'info', message: t('mobileSecurity.passkeys.nativeUnavailable') });
      return;
    }
    setWorking(true);
    setNotice(null);
    const options = await client.getPasskeyRegistrationOptions();
    if (!options.success || !options.data) {
      setWorking(false);
      setNotice({ kind: 'error', message: options.error ?? t('mobileSecurity.passkeys.optionsFailed') });
      return;
    }
    try {
      const credential = await adapter.createCredential(options.data.options);
      const response = await client.registerPasskey(
        options.data.registration_token,
        credential,
        parsed.data.deviceName,
      );
      setWorking(false);
      if (!response.success || !response.data) {
        setNotice({ kind: 'error', message: response.error ?? t('mobileSecurity.passkeys.registrationFailed') });
        return;
      }
      setNotice({ kind: 'success', message: response.data.message });
      if (response.data.recovery_codes?.length) {
        setRecoveryCodes(response.data.recovery_codes);
        onRecoveryCodes?.(response.data.recovery_codes);
      }
      await load();
    } catch (error) {
      setWorking(false);
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : t('mobileSecurity.passkeys.registrationCancelled'),
      });
    }
  });

  const requestDelete = (passkey: PasskeySummary) => {
    confirmationForm.reset({ confirmation: '' });
    setPendingDelete(passkey);
    setNotice(null);
  };

  const deleteSelected = confirmationForm.handleSubmit(async (values) => {
    const parsed = confirmationSchema.safeParse(values);
    if (!parsed.success) {
      confirmationForm.setError('confirmation', { message: t('mobileSecurity.passkeys.confirmationRequired') });
      return;
    }
    if (!pendingDelete) return;
    setWorking(true);
    const response = await client.deletePasskey(
      pendingDelete.id,
      hasPassword ? { password: parsed.data.confirmation } : { confirmationCode: parsed.data.confirmation },
    );
    setWorking(false);
    if (!response.success) {
      setNotice({ kind: 'error', message: response.error ?? t('mobileSecurity.passkeys.removeFailed') });
      return;
    }
    setPasskeys((current) => current.filter((passkey) => passkey.id !== pendingDelete.id));
    setPendingDelete(null);
    setNotice({ kind: 'success', message: response.data?.message ?? t('mobileSecurity.passkeys.removed') });
  });

  const sendConfirmationCode = async () => {
    setWorking(true);
    const response = await client.sendTwoFactorDisableCode();
    setWorking(false);
    setNotice(response.success
      ? { kind: 'success', message: response.data?.message ?? t('mobileSecurity.common.confirmationSent') }
      : { kind: 'error', message: response.error ?? t('mobileSecurity.common.confirmationFailed') });
  };

  return (
    <AuthScaffold
      title={t('mobileSecurity.passkeys.title')}
      subtitle={t('mobileSecurity.passkeys.subtitle')}
      testID="security-passkey-management-screen"
    >
      {loading ? <LoadingState label={t('mobileSecurity.passkeys.loading')} /> : null}
      {notice ? <StatusNotice kind={notice.kind} message={notice.message} /> : null}
      <Section title={t('mobileSecurity.passkeys.addSection')}>
        <Controller
          control={deviceForm.control}
          name="deviceName"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormField
              label={t('mobileSecurity.passkeys.name')}
              value={value}
              onBlur={onBlur}
              onChangeText={onChange}
              error={deviceForm.formState.errors.deviceName?.message}
              hint={t('mobileSecurity.passkeys.nameHint')}
            />
          )}
        />
        <ActionButton
          label={t('mobileSecurity.passkeys.create')}
          loading={working}
          disabled={!nativeReady}
          onPress={addPasskey}
        />
      </Section>
      <Section title={t('mobileSecurity.passkeys.registeredSection')}>
        {!loading && passkeys.length === 0 ? <StatusNotice kind="info" message={t('mobileSecurity.passkeys.empty')} /> : null}
        {passkeys.map((passkey) => (
          <ListAction
            key={passkey.id}
            title={passkey.device_name}
            detail={passkey.last_used_at
              ? t('mobileSecurity.passkeys.lastUsed', {
                  date: new Date(passkey.last_used_at).toLocaleDateString(i18n.resolvedLanguage),
                })
              : t('mobileSecurity.passkeys.neverUsed')}
            destructive
            onPress={() => requestDelete(passkey)}
          />
        ))}
      </Section>
      {pendingDelete ? (
        <Section
          title={t('mobileSecurity.passkeys.removeTitle', { name: pendingDelete.device_name })}
          description={t('mobileSecurity.passkeys.removeDescription')}
        >
          {!hasPassword ? (
            <ActionButton
              label={t('mobileSecurity.common.sendEmailConfirmationCode')}
              variant="secondary"
              loading={working}
              onPress={sendConfirmationCode}
            />
          ) : null}
          <Controller
            control={confirmationForm.control}
            name="confirmation"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormField
                label={hasPassword ? t('mobileSecurity.common.password') : t('mobileSecurity.common.emailConfirmationCode')}
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={confirmationForm.formState.errors.confirmation?.message}
                secureTextEntry={hasPassword}
                keyboardType={hasPassword ? 'default' : 'number-pad'}
                autoComplete={hasPassword ? 'current-password' : 'one-time-code'}
              />
            )}
          />
          <ActionButton label={t('mobileSecurity.passkeys.remove')} variant="danger" loading={working} onPress={deleteSelected} />
          <ActionButton label={t('mobileSecurity.common.cancel')} variant="plain" onPress={() => setPendingDelete(null)} />
        </Section>
      ) : null}
      {recoveryCodes?.length ? <RecoveryCodesPanel codes={recoveryCodes} /> : null}
    </AuthScaffold>
  );
}

export interface RecoveryCodesScreenProps {
  client?: BillManagerApi;
  onGenerated?: (codes: string[]) => void;
}

export function RecoveryCodesScreen({
  client = defaultApi,
  onGenerated,
}: RecoveryCodesScreenProps) {
  const { t } = useTranslation();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerate = () => {
    Alert.alert(
      t('mobileSecurity.recovery.regenerateTitle'),
      t('mobileSecurity.recovery.regenerateWarning'),
      [
        { text: t('mobileSecurity.common.cancel'), style: 'cancel' },
        {
          text: t('mobileSecurity.recovery.generate'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setWorking(true);
              setError(null);
              const response = await client.regenerateRecoveryCodes();
              setWorking(false);
              if (!response.success || !response.data) {
                setError(response.error ?? t('mobileSecurity.recovery.failed'));
                return;
              }
              setCodes(response.data.recovery_codes);
              onGenerated?.(response.data.recovery_codes);
            })();
          },
        },
      ],
    );
  };

  return (
    <AuthScaffold
      title={t('mobileSecurity.recovery.title')}
      subtitle={t('mobileSecurity.recovery.subtitle')}
      testID="security-recovery-codes-screen"
    >
      {error ? <StatusNotice kind="error" message={error} /> : null}
      <StatusNotice kind="warning" message={t('mobileSecurity.recovery.warning')} />
      <ActionButton label={t('mobileSecurity.recovery.generateNew')} variant="secondary" loading={working} onPress={regenerate} />
      {codes?.length ? <RecoveryCodesPanel codes={codes} /> : null}
    </AuthScaffold>
  );
}

export interface DisableTwoFactorScreenProps {
  client?: BillManagerApi;
  hasPassword: boolean;
  onDisabled?: () => void;
}

export function DisableTwoFactorScreen({
  client = defaultApi,
  hasPassword,
  onDisabled,
}: DisableTwoFactorScreenProps) {
  const { t } = useTranslation();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const form = useForm<z.input<typeof confirmationSchema>>({ defaultValues: { confirmation: '' } });

  const sendCode = async () => {
    setWorking(true);
    const response = await client.sendTwoFactorDisableCode();
    setWorking(false);
    setNotice(response.success
      ? { kind: 'success', message: response.data?.message ?? t('mobileSecurity.common.confirmationSent') }
      : { kind: 'error', message: response.error ?? t('mobileSecurity.common.confirmationFailed') });
  };

  const disable = form.handleSubmit(async (values) => {
    const parsed = confirmationSchema.safeParse(values);
    if (!parsed.success) {
      form.setError('confirmation', { message: t('mobileSecurity.passkeys.confirmationRequired') });
      return;
    }
    Alert.alert(
      t('mobileSecurity.disableTwoFactor.confirmTitle'),
      t('mobileSecurity.disableTwoFactor.confirmWarning'),
      [
        { text: t('mobileSecurity.common.cancel'), style: 'cancel' },
        {
          text: t('mobileSecurity.disableTwoFactor.disable'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setWorking(true);
              setNotice(null);
              const response = await client.disableTwoFactor(
                hasPassword
                  ? { password: parsed.data.confirmation }
                  : { confirmationCode: parsed.data.confirmation },
              );
              setWorking(false);
              if (!response.success) {
                setNotice({ kind: 'error', message: response.error ?? t('mobileSecurity.disableTwoFactor.failed') });
                return;
              }
              setNotice({ kind: 'success', message: response.data?.message ?? t('mobileSecurity.disableTwoFactor.success') });
              onDisabled?.();
            })();
          },
        },
      ],
    );
  });

  return (
    <AuthScaffold
      title={t('mobileSecurity.disableTwoFactor.title')}
      subtitle={t('mobileSecurity.disableTwoFactor.subtitle')}
      testID="security-disable-two-factor-screen"
    >
      <StatusNotice kind="warning" message={t('mobileSecurity.disableTwoFactor.warning')} />
      {notice ? <StatusNotice kind={notice.kind} message={notice.message} /> : null}
      {!hasPassword ? (
        <ActionButton label={t('mobileSecurity.common.sendEmailConfirmationCode')} variant="secondary" loading={working} onPress={sendCode} />
      ) : null}
      <Controller
        control={form.control}
        name="confirmation"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField
            label={hasPassword ? t('mobileSecurity.common.password') : t('mobileSecurity.common.emailConfirmationCode')}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={form.formState.errors.confirmation?.message}
            secureTextEntry={hasPassword}
            keyboardType={hasPassword ? 'default' : 'number-pad'}
            autoComplete={hasPassword ? 'current-password' : 'one-time-code'}
          />
        )}
      />
      <ActionButton label={t('mobileSecurity.disableTwoFactor.action')} variant="danger" loading={working} onPress={disable} />
    </AuthScaffold>
  );
}
