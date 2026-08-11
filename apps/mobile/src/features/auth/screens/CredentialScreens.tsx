import React, { useState } from 'react';
import {
  Controller,
  type Control,
  type FieldError,
  type FieldErrors,
  type FieldValues,
  type Path,
  useForm,
} from 'react-hook-form';
import { Text } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { api as defaultApi, BillManagerApi } from '../../../api/client';
import type { ServerCapabilities } from '../../../domain/serverProfile';
import { typography } from '../../../design/tokens';
import { useAdaptiveTheme } from '../../../design/useAdaptiveTheme';
import type { AuthFlowResult, AuthSessionScope } from '../types';
import { formatOAuthProviderNames } from '../oauthProviderNames';
import {
  emailSchema,
  loginSchema,
  passwordResetSchema,
  registrationSchema,
  validationErrors,
} from '../validation';
import {
  ActionButton,
  AuthScaffold,
  CapabilityUnavailable,
  FormField,
  StatusNotice,
} from '../components/AuthSurface';

function applyErrors(
  errors: Record<string, string>,
  setError: (name: never, error: { message: string }) => void,
  t: TFunction,
) {
  Object.entries(errors).forEach(([name, message]) => {
    setError(name as never, { message: localizeValidation(message, t) });
  });
}

function localizeValidation(message: string, t: TFunction): string {
  const keys: Record<string, string> = {
    'Enter a valid email address': 'mobileAuth.validation.email',
    'Username must be at least 3 characters': 'mobileAuth.validation.usernameMin',
    'Username must be 32 characters or less': 'mobileAuth.validation.usernameMax',
    'Use letters, numbers, underscores, or hyphens; start and end with a letter or number': 'mobileAuth.validation.usernameCharacters',
    'Password must be at least 8 characters': 'mobileAuth.validation.passwordMin',
    'Password must be 128 characters or less': 'mobileAuth.validation.passwordMax',
    'Password must contain an uppercase letter': 'mobileAuth.validation.passwordUppercase',
    'Password must contain a lowercase letter': 'mobileAuth.validation.passwordLowercase',
    'Password must contain a number': 'mobileAuth.validation.passwordNumber',
    'Enter your username': 'mobileAuth.validation.usernameRequired',
    'Enter your password': 'mobileAuth.validation.passwordRequired',
    'Passwords do not match': 'mobileAuth.validation.passwordsMismatch',
  };
  return keys[message] ? t(keys[message]) : message;
}

function activeCapabilities(client: BillManagerApi, override?: ServerCapabilities | null) {
  return override === undefined ? client.getActiveProfile().capabilities : override;
}

export interface LoginFlowScreenProps {
  client?: BillManagerApi;
  capabilities?: ServerCapabilities | null;
  onAuthenticated: (result: Extract<AuthFlowResult, { status: 'authenticated' }>) => void;
  onTwoFactorRequired: (
    result: Extract<AuthFlowResult, { status: 'two_factor_required' }>,
  ) => void;
  onPasswordChangeRequired: (changeToken: string, scope: AuthSessionScope) => void;
  onEmailVerificationRequired?: () => void;
  onForgotPassword?: () => void;
  onRegister?: () => void;
  onOAuth?: () => void;
  onChangeServer?: () => void;
}

export function LoginFlowScreen({
  client = defaultApi,
  capabilities: capabilitiesOverride,
  onAuthenticated,
  onTwoFactorRequired,
  onPasswordChangeRequired,
  onEmailVerificationRequired,
  onForgotPassword,
  onRegister,
  onOAuth,
  onChangeServer,
}: LoginFlowScreenProps) {
  const { t } = useTranslation();
  const capabilities = activeCapabilities(client, capabilitiesOverride);
  const oauthProviderNames = formatOAuthProviderNames(capabilities?.oauthProviders ?? []);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof loginSchema>>({
    defaultValues: { username: '', password: '' },
  });

  const submit = handleSubmit(async (values) => {
    setNotice(null);
    const fieldErrors = validationErrors(loginSchema, values);
    if (Object.keys(fieldErrors).length > 0) {
      applyErrors(fieldErrors, setError, t);
      return;
    }

    const result = await client.loginForFlow(values.username.trim(), values.password);
    switch (result.status) {
      case 'authenticated':
        onAuthenticated(result);
        break;
      case 'two_factor_required':
        onTwoFactorRequired(result);
        break;
      case 'password_change_required':
        onPasswordChangeRequired(result.changeToken, result.scope);
        break;
      case 'email_verification_required':
        setNotice(result.message);
        onEmailVerificationRequired?.();
        break;
      case 'error':
        setNotice(result.message);
        break;
    }
  });

  return (
    <AuthScaffold
      title={t('mobileAuth.login.title')}
      subtitle={t('mobileAuth.login.subtitle', { server: client.getActiveProfile().displayName })}
      footer={
        onRegister && capabilities?.registration ? (
          <ActionButton label={t('mobileAuth.login.createAccount')} variant="plain" onPress={onRegister} />
        ) : undefined
      }
      testID="auth-login-screen"
    >
      {notice ? <StatusNotice kind="error" message={notice} /> : null}
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
            autoComplete="username"
            returnKeyType="next"
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField
            label={t('mobileAuth.common.password')}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.password?.message}
            autoCapitalize="none"
            autoComplete="current-password"
            secureTextEntry
            onSubmitEditing={submit}
          />
        )}
      />
      <ActionButton label={t('mobileAuth.login.signIn')} loading={isSubmitting} onPress={submit} />
      {onForgotPassword ? (
        <ActionButton label={t('mobileAuth.login.forgotPassword')} variant="plain" onPress={onForgotPassword} />
      ) : null}
      {onOAuth && (capabilities?.oauthProviders.length ?? 0) > 0 ? (
        <ActionButton
          label={t('mobileAuth.login.connectedAccount', { providers: oauthProviderNames })}
          variant="secondary"
          onPress={onOAuth}
        />
      ) : null}
      {onChangeServer ? (
        <ActionButton
          label={t('mobileAuth.login.changeServer')}
          variant="plain"
          disabled={isSubmitting}
          onPress={onChangeServer}
        />
      ) : null}
    </AuthScaffold>
  );
}

export interface RegisterScreenProps {
  client?: BillManagerApi;
  capabilities?: ServerCapabilities | null;
  onComplete?: (emailVerificationRequired: boolean) => void;
  onSignIn?: () => void;
}

export function RegisterScreen({
  client = defaultApi,
  capabilities: capabilitiesOverride,
  onComplete,
  onSignIn,
}: RegisterScreenProps) {
  const { t } = useTranslation();
  const capabilities = activeCapabilities(client, capabilitiesOverride);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof registrationSchema>>({
    defaultValues: { username: '', email: '', password: '', confirmPassword: '' },
  });

  if (!capabilities?.registration) {
    return (
      <CapabilityUnavailable
        title={t('mobileAuth.register.title')}
        message={t('mobileAuth.register.unavailable')}
      />
    );
  }

  const submit = handleSubmit(async (values) => {
    setNotice(null);
    const result = registrationSchema.safeParse(values);
    if (!result.success) {
      applyErrors(validationErrors(registrationSchema, values), setError, t);
      return;
    }
    const response = await client.registerAccount({
      username: result.data.username,
      email: result.data.email,
      password: result.data.password,
    });
    if (!response.success || !response.data) {
      setNotice({ kind: 'error', message: response.error ?? t('mobileAuth.register.failed') });
      return;
    }
    setNotice({ kind: 'success', message: response.data.message });
    onComplete?.(Boolean(response.data.email_verification_required));
  });

  return (
    <AuthScaffold
      title={t('mobileAuth.register.title')}
      subtitle={t('mobileAuth.register.subtitle')}
      footer={onSignIn ? <ActionButton label={t('mobileAuth.register.back')} variant="plain" onPress={onSignIn} /> : undefined}
      testID="auth-register-screen"
    >
      {notice ? <StatusNotice kind={notice.kind} message={notice.message} /> : null}
      <Controller
        control={control}
        name="username"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField
            label={t('mobileAuth.common.username')}
            hint={t('mobileAuth.register.usernameHint')}
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
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField
            label={t('mobileAuth.common.email')}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.email?.message}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
        )}
      />
      <PasswordFields control={control} errors={errors} onSubmit={submit} t={t} />
      <ActionButton label={t('mobileAuth.register.submit')} loading={isSubmitting} onPress={submit} />
    </AuthScaffold>
  );
}

type PasswordFieldValues = {
  password: string;
  confirmPassword: string;
};

function PasswordFields<T extends FieldValues & PasswordFieldValues>({
  control,
  errors,
  onSubmit,
  t,
}: {
  control: Control<T>;
  errors: FieldErrors<T>;
  onSubmit: () => void;
  t: TFunction;
}) {
  const passwordError = errors.password as FieldError | undefined;
  const confirmationError = errors.confirmPassword as FieldError | undefined;
  return (
    <>
      <Controller<T>
        control={control}
        name={'password' as Path<T>}
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField
            label={t('mobileAuth.common.password')}
            hint={t('mobileAuth.common.passwordHint')}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={passwordError?.message}
            autoCapitalize="none"
            autoComplete="new-password"
            secureTextEntry
          />
        )}
      />
      <Controller<T>
        control={control}
        name={'confirmPassword' as Path<T>}
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField
            label={t('mobileAuth.common.confirmPassword')}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={confirmationError?.message}
            autoCapitalize="none"
            autoComplete="new-password"
            secureTextEntry
            onSubmitEditing={onSubmit}
          />
        )}
      />
    </>
  );
}

interface EmailRequestScreenProps {
  client?: BillManagerApi;
  mode: 'forgot' | 'resend';
  supported?: boolean;
  initialEmail?: string;
  onComplete?: () => void;
  onBack?: () => void;
}

export function EmailRequestScreen({
  client = defaultApi,
  mode,
  supported = true,
  initialEmail = '',
  onComplete,
  onBack,
}: EmailRequestScreenProps) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof emailSchema>>({ defaultValues: { email: initialEmail } });

  if (!supported) {
    return (
      <CapabilityUnavailable
        title={mode === 'forgot' ? t('mobileAuth.emailRequest.resetTitle') : t('mobileAuth.emailRequest.resendTitle')}
        message={t('mobileAuth.emailRequest.unavailable')}
      />
    );
  }

  const submit = handleSubmit(async (values) => {
    const result = emailSchema.safeParse(values);
    if (!result.success) {
      applyErrors(validationErrors(emailSchema, values), setError, t);
      return;
    }
    setNotice(null);
    const response = mode === 'forgot'
      ? await client.forgotPassword(result.data.email)
      : await client.resendEmailVerification(result.data.email);
    if (!response.success) {
      setNotice({ kind: 'error', message: response.error ?? t('mobileAuth.emailRequest.requestFailed') });
      return;
    }
    setNotice({
      kind: 'success',
      message: response.data?.message
        ?? (mode === 'forgot'
          ? t('mobileAuth.emailRequest.resetSuccess')
          : t('mobileAuth.emailRequest.resendSuccess')),
    });
    onComplete?.();
  });

  return (
    <AuthScaffold
      title={mode === 'forgot' ? t('mobileAuth.emailRequest.resetHeading') : t('mobileAuth.emailRequest.resendTitle')}
      subtitle={mode === 'forgot'
        ? t('mobileAuth.emailRequest.resetSubtitle')
        : t('mobileAuth.emailRequest.resendSubtitle')}
      footer={onBack ? <ActionButton label={t('mobileAuth.common.backToSignIn')} variant="plain" onPress={onBack} /> : undefined}
      testID={`auth-${mode}-screen`}
    >
      {notice ? <StatusNotice kind={notice.kind} message={notice.message} /> : null}
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField
            label={t('mobileAuth.common.email')}
            value={value}
            onBlur={onBlur}
            onChangeText={onChange}
            error={errors.email?.message}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onSubmitEditing={submit}
          />
        )}
      />
      <ActionButton
        label={mode === 'forgot' ? t('mobileAuth.emailRequest.sendReset') : t('mobileAuth.emailRequest.sendVerification')}
        loading={isSubmitting}
        onPress={submit}
      />
    </AuthScaffold>
  );
}

export const ForgotPasswordScreen = (props: Omit<EmailRequestScreenProps, 'mode'>) => (
  <EmailRequestScreen {...props} mode="forgot" />
);

export const ResendVerificationScreen = (props: Omit<EmailRequestScreenProps, 'mode'>) => (
  <EmailRequestScreen {...props} mode="resend" />
);

interface PasswordCompletionScreenProps {
  client?: BillManagerApi;
  token: string;
  mode: 'reset' | 'forced';
  authScope?: AuthSessionScope;
  onComplete?: () => void;
  onExpired?: () => void;
}

export function PasswordCompletionScreen({
  client = defaultApi,
  token,
  mode,
  authScope,
  onComplete,
  onExpired,
}: PasswordCompletionScreenProps) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme();
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof passwordResetSchema>>({
    defaultValues: { password: '', confirmPassword: '' },
  });

  if (!token) {
    return (
      <AuthScaffold title={t('mobileAuth.passwordCompletion.linkUnavailable')}>
        <StatusNotice kind="error" message={t('mobileAuth.passwordCompletion.linkMissing')} />
        {onExpired ? <ActionButton label={t('mobileAuth.common.requestNewLink')} onPress={onExpired} /> : null}
      </AuthScaffold>
    );
  }

  const submit = handleSubmit(async (values) => {
    const result = passwordResetSchema.safeParse(values);
    if (!result.success) {
      applyErrors(validationErrors(passwordResetSchema, values), setError, t);
      return;
    }
    setNotice(null);
    const response = mode === 'reset'
      ? await client.resetPassword(token, result.data.password)
      : await client.changeRequiredPassword(token, result.data.password, undefined, authScope);
    if (!response.success) {
      setNotice({ kind: 'error', message: response.error ?? t('mobileAuth.passwordCompletion.updateFailed') });
      return;
    }
    setNotice({ kind: 'success', message: t('mobileAuth.passwordCompletion.updated') });
    onComplete?.();
  });

  return (
    <AuthScaffold
      title={mode === 'reset' ? t('mobileAuth.passwordCompletion.resetTitle') : t('mobileAuth.passwordCompletion.forcedTitle')}
      subtitle={mode === 'forced'
        ? t('mobileAuth.passwordCompletion.forcedSubtitle')
        : t('mobileAuth.passwordCompletion.resetSubtitle')}
      testID={`auth-${mode}-password-screen`}
    >
      {notice ? <StatusNotice kind={notice.kind} message={notice.message} /> : null}
      <Text style={[typography.callout, { color: theme.colors.textSecondary }]}>
        {t('mobileAuth.passwordCompletion.requirements')}
      </Text>
      <PasswordFields control={control} errors={errors} onSubmit={submit} t={t} />
      <ActionButton
        label={mode === 'reset' ? t('mobileAuth.passwordCompletion.reset') : t('mobileAuth.passwordCompletion.save')}
        loading={isSubmitting}
        onPress={submit}
      />
    </AuthScaffold>
  );
}

export const ResetPasswordScreen = (
  props: Omit<PasswordCompletionScreenProps, 'mode'>,
) => <PasswordCompletionScreen {...props} mode="reset" />;

export const ForcedPasswordChangeScreen = (
  props: Omit<PasswordCompletionScreenProps, 'mode'>,
) => <PasswordCompletionScreen {...props} mode="forced" />;
