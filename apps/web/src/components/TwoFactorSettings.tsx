import { useState, useEffect, useCallback } from 'react';
import {
  Stack,
  Title,
  Text,
  Button,
  Group,
  Paper,
  Badge,
  ActionIcon,
  Alert,
  TextInput,
  Modal,
  Code,
  CopyButton,
  Tooltip,
  Loader,
  PinInput,
} from '@mantine/core';
import {
  IconShieldCheck,
  IconMail,
  IconKey,
  IconTrash,
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconRefresh,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '../context/ConfigContext';
import * as api from '../api/client';
import { getLocale } from '../lib/currency';

export function TwoFactorSettings() {
  const { t } = useTranslation();
  const { config } = useConfig();
  const [status, setStatus] = useState<api.TwoFAStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Email OTP setup
  const [setupToken, setSetupToken] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [settingUpEmail, setSettingUpEmail] = useState(false);
  const [confirmingEmail, setConfirmingEmail] = useState(false);

  // Recovery codes modal
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);

  // Disable 2FA
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [disabling, setDisabling] = useState(false);

  // Passkey setup
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [passkeyDeviceName, setPasskeyDeviceName] = useState('');

  const base64urlToArrayBuffer = (value: string): ArrayBuffer => {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytes.buffer as ArrayBuffer;
  };

  const arrayBufferToBase64url = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const fetchStatus = useCallback(async () => {
    try {
      const result = await api.get2FAStatus();
      setStatus(result);
    } catch {
      setError(t('twoFactorSettings.loadStatusFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (config?.twofa_enabled) {
      fetchStatus();
    } else {
      setLoading(false);
    }
  }, [config?.twofa_enabled, fetchStatus]);

  if (!config?.twofa_enabled) {
    return null;
  }

  if (loading) {
    return <Loader size="sm" />;
  }

  const handleSetupEmail = async () => {
    setSettingUpEmail(true);
    setError('');
    try {
      const result = await api.setup2FAEmail();
      setSetupToken(result.setup_token);
    } catch {
      setError(t('twoFactorSettings.sendCodeFailed'));
    } finally {
      setSettingUpEmail(false);
    }
  };

  const handleConfirmEmail = async () => {
    setConfirmingEmail(true);
    setError('');
    try {
      const result = await api.confirm2FAEmail(setupToken, setupCode);
      if (result.recovery_codes) {
        setRecoveryCodes(result.recovery_codes);
        setShowRecoveryCodes(true);
      }
      setSetupToken('');
      setSetupCode('');
      await fetchStatus();
    } catch {
      setError(t('twoFactorSettings.invalidCode'));
    } finally {
      setConfirmingEmail(false);
    }
  };

  const handleRegenerateRecoveryCodes = async () => {
    try {
      const result = await api.getRecoveryCodes();
      setRecoveryCodes(result.recovery_codes);
      setShowRecoveryCodes(true);
    } catch {
      setError(t('twoFactorSettings.regenerateFailed'));
    }
  };

  const handleDeletePasskey = async (passkeyId: number) => {
    try {
      await api.deletePasskey(passkeyId);
      await fetchStatus();
    } catch {
      setError(t('twoFactorSettings.deletePasskeyFailed'));
    }
  };

  const handleRegisterPasskey = async () => {
    setRegisteringPasskey(true);
    setError('');
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) {
        setError(t('twoFactorSettings.passkeysNotSupported'));
        return;
      }

      const { options, registration_token } = await api.getPasskeyRegistrationOptions();
      const publicKeyOptions = options as Record<string, unknown>;

      const challenge = publicKeyOptions.challenge as string;
      const user = publicKeyOptions.user as Record<string, unknown>;
      const excludeCredentials = (publicKeyOptions.excludeCredentials as Array<Record<string, unknown>> | undefined) || [];

      const credential = (await navigator.credentials.create({
        publicKey: {
          ...(publicKeyOptions as unknown as PublicKeyCredentialCreationOptions),
          challenge: base64urlToArrayBuffer(challenge),
          user: {
            ...(user as unknown as PublicKeyCredentialUserEntity),
            id: base64urlToArrayBuffer(user.id as string),
          },
          excludeCredentials: excludeCredentials.map((excluded) => ({
            ...(excluded as unknown as PublicKeyCredentialDescriptor),
            id: base64urlToArrayBuffer(excluded.id as string),
          })),
        },
      })) as PublicKeyCredential | null;

      if (!credential) {
        setError(t('twoFactorSettings.passkeyCancelled'));
        return;
      }

      const response = credential.response as AuthenticatorAttestationResponse;
      const registrationPayload = {
        id: credential.id,
        rawId: arrayBufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: arrayBufferToBase64url(response.clientDataJSON),
          attestationObject: arrayBufferToBase64url(response.attestationObject),
          transports: response.getTransports ? response.getTransports() : [],
        },
        clientExtensionResults: credential.getClientExtensionResults(),
      };

      const result = await api.registerPasskey(
        registration_token,
        registrationPayload as unknown as Record<string, unknown>,
        passkeyDeviceName.trim() || t('twoFactorSettings.securityKeyDefault')
      );

      if (result.recovery_codes) {
        setRecoveryCodes(result.recovery_codes);
        setShowRecoveryCodes(true);
      }

      await fetchStatus();
    } catch (error: unknown) {
      if (error instanceof api.ApiError) {
        setError(error.message);
      } else {
        setError(t('twoFactorSettings.passkeyRegisterFailedDefault'));
      }
    } finally {
      setRegisteringPasskey(false);
    }
  };

  const handleDisable2FA = async () => {
    setDisabling(true);
    setError('');
    try {
      await api.disable2FA(disablePassword);
      setShowDisable(false);
      setDisablePassword('');
      await fetchStatus();
    } catch {
      setError(t('twoFactorSettings.disableFailed'));
    } finally {
      setDisabling(false);
    }
  };

  return (
    <>
      <Stack gap="md">
        <Group>
          <IconShieldCheck size={24} />
          <Title order={4}>{t('twoFactorSettings.title')}</Title>
          {status?.enabled && <Badge color="green">{t('twoFactorSettings.enabledBadge')}</Badge>}
        </Group>

        <Text size="sm" c="dimmed">
          {t('twoFactorSettings.description')}
        </Text>

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" withCloseButton onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {/* Email OTP */}
        <Paper withBorder p="md">
          <Group justify="space-between">
            <Group>
              <IconMail size={20} />
              <div>
                <Text fw={500}>{t('twoFactorSettings.emailOtpTitle')}</Text>
                <Text size="xs" c="dimmed">{t('twoFactorSettings.emailOtpDescription')}</Text>
              </div>
            </Group>
            {status?.email_otp_enabled ? (
              <Badge color="green">{t('twoFactorSettings.activeBadge')}</Badge>
            ) : setupToken ? (
              <Group gap="xs">
                <PinInput
                  length={6}
                  type="number"
                  value={setupCode}
                  onChange={setSetupCode}
                  size="xs"
                />
                <Button size="xs" onClick={handleConfirmEmail} loading={confirmingEmail} disabled={setupCode.length !== 6}>
                  {t('twoFactorSettings.verify')}
                </Button>
              </Group>
            ) : (
              <Button size="xs" variant="light" onClick={handleSetupEmail} loading={settingUpEmail}>
                {t('twoFactorSettings.enable')}
              </Button>
            )}
          </Group>
        </Paper>

        {/* Passkeys */}
        {config?.passkeys_enabled && (
          <Paper withBorder p="md">
            <Group justify="space-between" mb={status?.passkeys?.length ? 'sm' : 0}>
              <Group>
                <IconKey size={20} />
                <div>
                  <Text fw={500}>{t('twoFactorSettings.passkeysTitle')}</Text>
                  <Text size="xs" c="dimmed">{t('twoFactorSettings.passkeysDescription')}</Text>
                </div>
              </Group>
              <Badge color={status?.passkey_enabled ? 'green' : 'gray'}>
                {t('twoFactorSettings.passkeysRegisteredCount', { count: status?.passkeys?.length || 0 })}
              </Badge>
            </Group>
            <Group gap="xs" mt="sm">
              <TextInput
                size="xs"
                placeholder={t('twoFactorSettings.devicePlaceholder')}
                value={passkeyDeviceName}
                onChange={(e) => setPasskeyDeviceName(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                variant="light"
                leftSection={<IconKey size={14} />}
                onClick={handleRegisterPasskey}
                loading={registeringPasskey}
              >
                {t('twoFactorSettings.addPasskey')}
              </Button>
            </Group>
            {status?.passkeys && status.passkeys.length > 0 && (
              <Stack gap="xs" mt="sm">
                {status.passkeys.map((passkey) => (
                  <Group key={passkey.id} justify="space-between" p="xs" style={{ borderRadius: 4, background: 'var(--mantine-color-default)' }}>
                    <div>
                      <Text size="sm" fw={500}>{passkey.device_name}</Text>
                      <Text size="xs" c="dimmed">
                        {t('twoFactorSettings.addedOn', { date: passkey.created_at ? new Date(passkey.created_at).toLocaleDateString(getLocale()) : t('common.unknown') })}
                        {passkey.last_used_at && t('twoFactorSettings.lastUsed', { date: new Date(passkey.last_used_at).toLocaleDateString(getLocale()) })}
                      </Text>
                    </div>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => handleDeletePasskey(passkey.id)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}
          </Paper>
        )}

        {/* Recovery Codes */}
        {status?.enabled && (
          <Paper withBorder p="md">
            <Group justify="space-between">
              <div>
                <Text fw={500}>{t('twoFactorSettings.recoveryCodesTitle')}</Text>
                <Text size="xs" c="dimmed">
                  {status.has_recovery_codes
                    ? t('twoFactorSettings.recoveryCodesHasDescription')
                    : t('twoFactorSettings.recoveryCodesGenerateDescription')}
                </Text>
              </div>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconRefresh size={14} />}
                onClick={handleRegenerateRecoveryCodes}
              >
                {status.has_recovery_codes ? t('twoFactorSettings.regenerate') : t('twoFactorSettings.generate')}
              </Button>
            </Group>
          </Paper>
        )}

        {/* Disable 2FA */}
        {status?.enabled && (
          <Button
            variant="subtle"
            color="red"
            size="sm"
            onClick={() => setShowDisable(true)}
          >
            {t('twoFactorSettings.disableButton')}
          </Button>
        )}
      </Stack>

      {/* Recovery Codes Modal */}
      <Modal
        opened={showRecoveryCodes}
        onClose={() => setShowRecoveryCodes(false)}
        title={t('twoFactorSettings.recoveryCodesTitle')}
        size="sm"
      >
        <Stack gap="md">
          <Alert icon={<IconAlertCircle size={16} />} color="orange">
            {t('twoFactorSettings.recoveryCodesWarning')}
          </Alert>
          <Paper withBorder p="md" bg="gray.0">
            <Stack gap={4}>
              {recoveryCodes?.map((code, i) => (
                <Group key={i} gap="xs">
                  <Code style={{ fontFamily: 'monospace', fontSize: 14, letterSpacing: 2 }}>
                    {code}
                  </Code>
                </Group>
              ))}
            </Stack>
          </Paper>
          <CopyButton value={recoveryCodes?.join('\n') || ''}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? t('twoFactorSettings.copied') : t('twoFactorSettings.copyAllCodes')}>
                <Button
                  variant="light"
                  leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  onClick={copy}
                  fullWidth
                >
                  {copied ? t('twoFactorSettings.copied') : t('twoFactorSettings.copyAllCodesButton')}
                </Button>
              </Tooltip>
            )}
          </CopyButton>
          <Button onClick={() => setShowRecoveryCodes(false)}>
            {t('twoFactorSettings.savedCodes')}
          </Button>
        </Stack>
      </Modal>

      {/* Disable 2FA Modal */}
      <Modal
        opened={showDisable}
        onClose={() => { setShowDisable(false); setDisablePassword(''); }}
        title={t('twoFactorSettings.disableModalTitle')}
        size="sm"
      >
        <Stack gap="md">
          <Alert icon={<IconAlertCircle size={16} />} color="red">
            {t('twoFactorSettings.disableWarning')}
          </Alert>
          <TextInput
            label={t('twoFactorSettings.confirmPasswordLabel')}
            type="password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.currentTarget.value)}
            placeholder={t('twoFactorSettings.confirmPasswordPlaceholder')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setShowDisable(false); setDisablePassword(''); }}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              color="red"
              onClick={handleDisable2FA}
              loading={disabling}
              disabled={!disablePassword}
            >
              {t('twoFactorSettings.disableConfirmButton')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
