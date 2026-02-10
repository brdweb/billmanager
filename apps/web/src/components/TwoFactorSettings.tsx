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
import { useConfig } from '../context/ConfigContext';
import * as api from '../api/client';

export function TwoFactorSettings() {
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

  const fetchStatus = useCallback(async () => {
    try {
      const result = await api.get2FAStatus();
      setStatus(result);
    } catch {
      setError('Failed to load 2FA status');
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError('Failed to send verification code');
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
      setError('Invalid verification code');
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
      setError('Failed to regenerate recovery codes');
    }
  };

  const handleDeletePasskey = async (passkeyId: number) => {
    try {
      await api.deletePasskey(passkeyId);
      await fetchStatus();
    } catch {
      setError('Failed to delete passkey');
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
      setError('Failed to disable 2FA. Check your password.');
    } finally {
      setDisabling(false);
    }
  };

  return (
    <>
      <Stack gap="md">
        <Group>
          <IconShieldCheck size={24} />
          <Title order={4}>Two-Factor Authentication</Title>
          {status?.enabled && <Badge color="green">Enabled</Badge>}
        </Group>

        <Text size="sm" c="dimmed">
          Add an extra layer of security to your account by requiring a second form of verification.
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
                <Text fw={500}>Email Verification Code</Text>
                <Text size="xs" c="dimmed">Receive a 6-digit code via email when signing in</Text>
              </div>
            </Group>
            {status?.email_otp_enabled ? (
              <Badge color="green">Active</Badge>
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
                  Verify
                </Button>
              </Group>
            ) : (
              <Button size="xs" variant="light" onClick={handleSetupEmail} loading={settingUpEmail}>
                Enable
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
                  <Text fw={500}>Passkeys</Text>
                  <Text size="xs" c="dimmed">Use a security key or biometrics for 2FA</Text>
                </div>
              </Group>
              <Badge color={status?.passkey_enabled ? 'green' : 'gray'}>
                {status?.passkeys?.length || 0} registered
              </Badge>
            </Group>
            {status?.passkeys && status.passkeys.length > 0 && (
              <Stack gap="xs" mt="sm">
                {status.passkeys.map((passkey) => (
                  <Group key={passkey.id} justify="space-between" p="xs" style={{ borderRadius: 4, background: 'var(--mantine-color-gray-0)' }}>
                    <div>
                      <Text size="sm" fw={500}>{passkey.device_name}</Text>
                      <Text size="xs" c="dimmed">
                        Added {passkey.created_at ? new Date(passkey.created_at).toLocaleDateString() : 'unknown'}
                        {passkey.last_used_at && ` · Last used ${new Date(passkey.last_used_at).toLocaleDateString()}`}
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
                <Text fw={500}>Recovery Codes</Text>
                <Text size="xs" c="dimmed">
                  {status.has_recovery_codes
                    ? 'Use a recovery code if you lose access to your 2FA methods'
                    : 'Generate recovery codes as a backup'}
                </Text>
              </div>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconRefresh size={14} />}
                onClick={handleRegenerateRecoveryCodes}
              >
                {status.has_recovery_codes ? 'Regenerate' : 'Generate'}
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
            Disable Two-Factor Authentication
          </Button>
        )}
      </Stack>

      {/* Recovery Codes Modal */}
      <Modal
        opened={showRecoveryCodes}
        onClose={() => setShowRecoveryCodes(false)}
        title="Recovery Codes"
        size="sm"
      >
        <Stack gap="md">
          <Alert icon={<IconAlertCircle size={16} />} color="orange">
            Save these codes somewhere safe. Each code can only be used once.
            If you lose your 2FA device, these codes are the only way to access your account.
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
              <Tooltip label={copied ? 'Copied!' : 'Copy all codes'}>
                <Button
                  variant="light"
                  leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  onClick={copy}
                  fullWidth
                >
                  {copied ? 'Copied!' : 'Copy All Codes'}
                </Button>
              </Tooltip>
            )}
          </CopyButton>
          <Button onClick={() => setShowRecoveryCodes(false)}>
            I&apos;ve saved my codes
          </Button>
        </Stack>
      </Modal>

      {/* Disable 2FA Modal */}
      <Modal
        opened={showDisable}
        onClose={() => { setShowDisable(false); setDisablePassword(''); }}
        title="Disable Two-Factor Authentication"
        size="sm"
      >
        <Stack gap="md">
          <Alert icon={<IconAlertCircle size={16} />} color="red">
            This will remove all 2FA protection from your account. You will only need your password to sign in.
          </Alert>
          <TextInput
            label="Confirm your password"
            type="password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.currentTarget.value)}
            placeholder="Enter your password"
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setShowDisable(false); setDisablePassword(''); }}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={handleDisable2FA}
              loading={disabling}
              disabled={!disablePassword}
            >
              Disable 2FA
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
