import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { api as defaultApi, BillManagerApi } from '../../../api/client';
import type { ServerCapabilities } from '../../../domain/serverProfile';
import { typography } from '../../../design/tokens';
import { useAdaptiveTheme } from '../../../design/useAdaptiveTheme';
import { formatCurrency } from '../../../i18n/format';
import { getShareInviteDisplay } from '../shareInviteModel';
import type { ShareInviteInfo, TeamInviteInfo } from '../types';
import { inviteAcceptanceSchema, validationErrors } from '../validation';
import {
  ActionButton,
  AuthScaffold,
  CapabilityUnavailable,
  FormField,
  LoadingState,
  StatusNotice,
} from '../components/AuthSurface';

function applyInviteErrors(
  values: z.input<typeof inviteAcceptanceSchema>,
  setError: (name: never, error: { message: string }) => void,
  t: TFunction,
) {
  Object.entries(validationErrors(inviteAcceptanceSchema, values)).forEach(([name, message]) => {
    const validationKey: Record<string, string> = {
      'Username must be at least 3 characters': 'mobileAuth.validation.usernameMin',
      'Username must be 32 characters or less': 'mobileAuth.validation.usernameMax',
      'Use letters, numbers, underscores, or hyphens; start and end with a letter or number': 'mobileAuth.validation.usernameCharacters',
      'Password must be at least 8 characters': 'mobileAuth.validation.passwordMin',
      'Password must be 128 characters or less': 'mobileAuth.validation.passwordMax',
      'Password must contain an uppercase letter': 'mobileAuth.validation.passwordUppercase',
      'Password must contain a lowercase letter': 'mobileAuth.validation.passwordLowercase',
      'Password must contain a number': 'mobileAuth.validation.passwordNumber',
      'Passwords do not match': 'mobileAuth.validation.passwordsMismatch',
    };
    setError(name as never, { message: validationKey[message] ? t(validationKey[message]) : message });
  });
}

export interface TeamInviteAcceptanceScreenProps {
  client?: BillManagerApi;
  token: string;
  onAccepted?: (username: string) => void;
  onSignIn?: () => void;
}

export function TeamInviteAcceptanceScreen({
  client = defaultApi,
  token,
  onAccepted,
  onSignIn,
}: TeamInviteAcceptanceScreenProps) {
  const { t } = useTranslation();
  const [invite, setInvite] = useState<TeamInviteInfo | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    token ? null : { kind: 'error', message: t('mobileAuth.teamInvite.incomplete') },
  );
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof inviteAcceptanceSchema>>({
    defaultValues: { username: '', password: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (!token) return;
    let active = true;
    void client.getTeamInviteInfo(token).then((response) => {
      if (!active) return;
      setLoading(false);
      if (response.success && response.data) {
        setInvite(response.data);
      } else {
        setNotice({ kind: 'error', message: response.error ?? t('mobileAuth.teamInvite.invalid') });
      }
    });
    return () => {
      active = false;
    };
  }, [client, token]);

  const submit = handleSubmit(async (values) => {
    const parsed = inviteAcceptanceSchema.safeParse(values);
    if (!parsed.success) {
      applyInviteErrors(values, setError, t);
      return;
    }
    setNotice(null);
    const response = await client.acceptTeamInvite(
      token,
      parsed.data.username,
      parsed.data.password,
    );
    if (!response.success || !response.data) {
      setNotice({ kind: 'error', message: response.error ?? t('mobileAuth.teamInvite.acceptFailed') });
      return;
    }
    setNotice({ kind: 'success', message: response.data.message });
    onAccepted?.(response.data.username);
  });

  return (
    <AuthScaffold
      title={t('mobileAuth.teamInvite.title')}
      subtitle={invite
        ? t('mobileAuth.teamInvite.subtitle', { inviter: invite.invited_by, email: invite.email })
        : t('mobileAuth.teamInvite.review')}
      footer={onSignIn ? <ActionButton label={t('mobileAuth.teamInvite.existingAccount')} variant="plain" onPress={onSignIn} /> : undefined}
      testID="auth-team-invite-screen"
    >
      {loading ? <LoadingState label={t('mobileAuth.teamInvite.loading')} /> : null}
      {notice ? <StatusNotice kind={notice.kind} message={notice.message} /> : null}
      {invite ? (
        <>
          <Controller
            control={control}
            name="username"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormField
                label={t('mobileAuth.common.username')}
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={errors.username?.message}
                autoCapitalize="none"
                autoComplete="username-new"
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormField
                label={t('mobileAuth.common.password')}
                hint={t('mobileAuth.common.passwordHint')}
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={errors.password?.message}
                autoCapitalize="none"
                autoComplete="new-password"
                secureTextEntry
              />
            )}
          />
          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <FormField
                label={t('mobileAuth.common.confirmPassword')}
                value={value}
                onBlur={onBlur}
                onChangeText={onChange}
                error={errors.confirmPassword?.message}
                autoComplete="new-password"
                secureTextEntry
                onSubmitEditing={submit}
              />
            )}
          />
          <ActionButton label={t('mobileAuth.teamInvite.submit')} loading={isSubmitting} onPress={submit} />
        </>
      ) : null}
    </AuthScaffold>
  );
}

export interface ShareInviteAcceptanceScreenProps {
  client?: BillManagerApi;
  token: string;
  capabilities?: ServerCapabilities | null;
  authenticated: boolean;
  onAccepted?: (shareId: number) => void;
  onSignIn?: () => void;
  onCreateAccount?: () => void;
}

export function ShareInviteAcceptanceScreen({
  client = defaultApi,
  token,
  capabilities: override,
  authenticated,
  onAccepted,
  onSignIn,
  onCreateAccount,
}: ShareInviteAcceptanceScreenProps) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme();
  const capabilities = override === undefined ? client.getActiveProfile().capabilities : override;
  const [invite, setInvite] = useState<ShareInviteInfo | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [accepting, setAccepting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    token ? null : { kind: 'error', message: t('mobileAuth.shareInvite.incomplete') },
  );

  useEffect(() => {
    if (!token || !capabilities?.sharing) return;
    let active = true;
    void client.getShareInviteInfo(token).then((response) => {
      if (!active) return;
      setLoading(false);
      if (response.success && response.data) setInvite(response.data);
      else setNotice({ kind: 'error', message: response.error ?? t('mobileAuth.shareInvite.invalid') });
    });
    return () => {
      active = false;
    };
  }, [capabilities?.sharing, client, token]);

  if (!capabilities?.sharing) {
    return (
      <CapabilityUnavailable
        title={t('mobileAuth.shareInvite.unavailableTitle')}
        message={t('mobileAuth.shareInvite.unavailable')}
      />
    );
  }

  const accept = async () => {
    setAccepting(true);
    setNotice(null);
    const response = await client.acceptShareInvite(token);
    setAccepting(false);
    if (!response.success || !response.data) {
      setNotice({ kind: 'error', message: response.error ?? t('mobileAuth.shareInvite.acceptFailed') });
      return;
    }
    setNotice({ kind: 'success', message: response.data.message });
    onAccepted?.(response.data.share_id);
  };
  const inviteDisplay = invite ? getShareInviteDisplay(invite) : null;

  return (
    <AuthScaffold title={t('mobileAuth.shareInvite.title')} subtitle={t('mobileAuth.shareInvite.subtitle')}>
      {loading ? <LoadingState label={t('mobileAuth.shareInvite.loading')} /> : null}
      {notice ? <StatusNotice kind={notice.kind} message={notice.message} /> : null}
      {invite ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>
            {invite.bill_name}
          </Text>
          <Text style={[typography.body, { color: theme.colors.textSecondary }]}>
            {inviteDisplay?.recipient
              ? t('mobileAuth.shareInvite.sharedBy', {
                owner: inviteDisplay.owner,
                email: inviteDisplay.recipient,
              })
              : t('mobileAuth.shareInvite.sharedByOwner', { owner: inviteDisplay?.owner })}
          </Text>
          {invite.my_portion != null ? (
            <Text style={[typography.headline, { color: theme.colors.text }]}>
              {t('mobileAuth.shareInvite.portion', { amount: formatCurrency(invite.my_portion) })}
            </Text>
          ) : null}
          {authenticated ? (
            <ActionButton label={t('mobileAuth.shareInvite.accept')} loading={accepting} onPress={accept} />
          ) : (
            <>
              {onSignIn ? <ActionButton label={t('mobileAuth.shareInvite.signIn')} onPress={onSignIn} /> : null}
              {onCreateAccount ? (
                <ActionButton label={t('mobileAuth.shareInvite.createAccount')} variant="secondary" onPress={onCreateAccount} />
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </AuthScaffold>
  );
}
