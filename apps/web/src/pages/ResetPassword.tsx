import { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  PasswordInput,
  Button,
  Stack,
  Alert,
  Text,
  Progress,
  List,
} from '@mantine/core';
import { IconLock, IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import * as api from '../api/client';

function getPasswordStrength(password: string): number {
  let strength = 0;
  if (password.length >= 8) strength += 25;
  if (password.length >= 12) strength += 15;
  if (/[a-z]/.test(password)) strength += 15;
  if (/[A-Z]/.test(password)) strength += 15;
  if (/[0-9]/.test(password)) strength += 15;
  if (/[^a-zA-Z0-9]/.test(password)) strength += 15;
  return Math.min(100, strength);
}

function getPasswordColor(strength: number): string {
  if (strength < 30) return 'red';
  if (strength < 60) return 'yellow';
  if (strength < 80) return 'blue';
  return 'green';
}

export function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const passwordStrength = getPasswordStrength(password);

  const validatePassword = (): string | null => {
    if (!password) return t('loginPage.passwordRequired');
    if (password.length < 8) return t('loginPage.passwordMinLength');
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
      return t('loginPage.passwordCase');
    }
    if (!/[0-9]/.test(password)) return t('loginPage.passwordNumber');
    if (password !== confirmPassword) return t('loginPage.passwordsMismatch');
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError(t('resetPasswordPage.invalidResetLink'));
      return;
    }

    const validationError = validatePassword();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const response = await api.resetPassword(token, password);
      if (response.success) {
        setSuccess(true);
      } else {
        setError(response.error || t('resetPasswordPage.resetFailedDefault'));
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || t('resetPasswordPage.resetFailedExpired'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Container size={420} my={40}>
        <Paper withBorder shadow="md" p={30} radius="md">
          <Stack align="center" gap="md">
            <IconAlertCircle size={48} color="var(--mantine-color-red-6)" />
            <Title order={2} ta="center">{t('resetPasswordPage.invalidLinkTitle')}</Title>
            <Text c="dimmed" ta="center">
              {t('resetPasswordPage.invalidLinkBody')}
            </Text>
            <Button component={Link} to="/forgot-password" fullWidth>
              {t('resetPasswordPage.requestNewLink')}
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  if (success) {
    return (
      <Container size={420} my={40}>
        <Paper withBorder shadow="md" p={30} radius="md">
          <Stack align="center" gap="md">
            <IconCheck size={48} color="var(--mantine-color-green-6)" />
            <Title order={2} ta="center">{t('resetPasswordPage.passwordResetTitle')}</Title>
            <Text c="dimmed" ta="center">
              {t('resetPasswordPage.passwordResetBody')}
            </Text>
            <Button onClick={() => navigate('/login')} fullWidth>
              {t('loginPage.signIn')}
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size={420} my={40}>
      <Title ta="center">{t('resetPasswordPage.title')}</Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        {t('resetPasswordPage.subtitle')}
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {error && (
              <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
                {error}
              </Alert>
            )}

            <div>
              <PasswordInput
                label={t('passwordChangeModal.newPasswordLabel')}
                placeholder={t('loginPage.createPasswordPlaceholder')}
                leftSection={<IconLock size={16} />}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
              />
              {password && (
                <>
                  <Progress
                    value={passwordStrength}
                    color={getPasswordColor(passwordStrength)}
                    size="xs"
                    mt={5}
                  />
                  <Text size="xs" c="dimmed" mt={5}>
                    {t('acceptInvite.passwordRequirements')}
                  </Text>
                  <List size="xs" c="dimmed" spacing={0}>
                    <List.Item c={password.length >= 8 ? 'green' : undefined}>
                      {t('loginPage.atLeast8Chars')}
                    </List.Item>
                    <List.Item c={/[a-z]/.test(password) && /[A-Z]/.test(password) ? 'green' : undefined}>
                      {t('loginPage.upperLowerLetters')}
                    </List.Item>
                    <List.Item c={/[0-9]/.test(password) ? 'green' : undefined}>
                      {t('loginPage.atLeastOneNumber')}
                    </List.Item>
                  </List>
                </>
              )}
            </div>

            <PasswordInput
              label={t('loginPage.confirmPasswordLabel')}
              placeholder={t('resetPasswordPage.confirmPasswordPlaceholder2')}
              leftSection={<IconLock size={16} />}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              error={confirmPassword && password !== confirmPassword ? t('loginPage.passwordsMismatch') : undefined}
              required
            />

            <Button type="submit" fullWidth loading={loading}>
              {t('resetPasswordPage.submitButton')}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
