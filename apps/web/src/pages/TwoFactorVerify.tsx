import { useState } from 'react';
import {
  Container,
  Paper,
  Title,
  Text,
  TextInput,
  Button,
  Stack,
  Alert,
  SegmentedControl,
  Box,
  PinInput,
  Anchor,
} from '@mantine/core';
import {
  IconShieldCheck,
  IconAlertCircle,
  IconMail,
  IconKey,
  IconLifebuoy,
} from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api/client';

export function TwoFactorVerify() {
  const { pending2FA, complete2FA, cancel2FA } = useAuth();

  const [method, setMethod] = useState<string>(
    pending2FA?.methods?.includes('email_otp') ? 'email_otp' : 'recovery'
  );
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  if (!pending2FA) {
    return null;
  }

  const handleSendCode = async () => {
    setSendingCode(true);
    setError('');
    try {
      await api.request2FAChallenge(pending2FA.sessionToken, 'email_otp');
      setCodeSent(true);
    } catch {
      setError('Failed to send verification code. Please try again.');
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerify = async () => {
    setError('');
    setLoading(true);
    try {
      let payload: Record<string, unknown> = {};

      if (method === 'email_otp') {
        if (!code || code.length !== 6) {
          setError('Please enter the 6-digit code');
          setLoading(false);
          return;
        }
        payload = { code };
      } else if (method === 'recovery') {
        if (!recoveryCode.trim()) {
          setError('Please enter a recovery code');
          setLoading(false);
          return;
        }
        payload = { recovery_code: recoveryCode.trim() };
      }

      const result = await complete2FA(method, payload);
      if (!result.success) {
        setError(result.error || 'Verification failed');
      }
      // On success, AuthContext will update state and trigger navigation
    } catch {
      setError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const methodOptions = [];
  if (pending2FA.methods.includes('email_otp')) {
    methodOptions.push({ label: 'Email Code', value: 'email_otp' });
  }
  if (pending2FA.methods.includes('passkey')) {
    methodOptions.push({ label: 'Passkey', value: 'passkey' });
  }
  if (pending2FA.methods.includes('recovery')) {
    methodOptions.push({ label: 'Recovery', value: 'recovery' });
  }

  return (
    <Box
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #059669 0%, #064e3b 100%)',
      }}
    >
      <Container size={420}>
        <Paper withBorder shadow="xl" p={30} radius="md">
          <Stack gap="lg" align="center">
            <IconShieldCheck size={48} color="var(--mantine-color-green-6)" />
            <Title order={2} ta="center">Two-Factor Authentication</Title>
            <Text c="dimmed" size="sm" ta="center">
              Your account is protected with 2FA. Please verify your identity.
            </Text>

            {methodOptions.length > 1 && (
              <SegmentedControl
                fullWidth
                value={method}
                onChange={(val) => { setMethod(val); setError(''); }}
                data={methodOptions}
              />
            )}

            {error && (
              <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" w="100%">
                {error}
              </Alert>
            )}

            {method === 'email_otp' && (
              <Stack gap="md" w="100%">
                {!codeSent ? (
                  <Button
                    fullWidth
                    leftSection={<IconMail size={18} />}
                    onClick={handleSendCode}
                    loading={sendingCode}
                  >
                    Send Code to Email
                  </Button>
                ) : (
                  <>
                    <Text size="sm" c="dimmed" ta="center">
                      Enter the 6-digit code sent to your email
                    </Text>
                    <PinInput
                      length={6}
                      type="number"
                      value={code}
                      onChange={setCode}
                      oneTimeCode
                      style={{ justifyContent: 'center' }}
                    />
                    <Button
                      fullWidth
                      onClick={handleVerify}
                      loading={loading}
                      disabled={code.length !== 6}
                    >
                      Verify Code
                    </Button>
                    <Anchor
                      component="button"
                      size="xs"
                      ta="center"
                      onClick={handleSendCode}
                    >
                      Resend code
                    </Anchor>
                  </>
                )}
              </Stack>
            )}

            {method === 'passkey' && (
              <Stack gap="md" w="100%">
                <Text size="sm" c="dimmed" ta="center">
                  Use your passkey to verify your identity.
                </Text>
                <Button
                  fullWidth
                  leftSection={<IconKey size={18} />}
                  onClick={handleVerify}
                  loading={loading}
                >
                  Use Passkey
                </Button>
              </Stack>
            )}

            {method === 'recovery' && (
              <Stack gap="md" w="100%">
                <Text size="sm" c="dimmed" ta="center">
                  Enter one of your recovery codes
                </Text>
                <TextInput
                  leftSection={<IconLifebuoy size={16} />}
                  placeholder="XXXXXXXX"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.currentTarget.value)}
                  styles={{ input: { textTransform: 'uppercase', letterSpacing: '2px', fontFamily: 'monospace' } }}
                />
                <Button
                  fullWidth
                  onClick={handleVerify}
                  loading={loading}
                  disabled={!recoveryCode.trim()}
                >
                  Verify Recovery Code
                </Button>
              </Stack>
            )}

            <Anchor component="button" size="sm" onClick={cancel2FA}>
              Cancel and go back
            </Anchor>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
