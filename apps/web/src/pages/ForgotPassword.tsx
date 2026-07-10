import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  TextInput,
  Button,
  Stack,
  Alert,
  Text,
  Anchor,
} from '@mantine/core';
import { IconMail, IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import * as api from '../api/client';

export function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError(t('loginPage.emailRequired'));
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('forgotPasswordPage.invalidEmail'));
      return;
    }

    setLoading(true);
    try {
      const response = await api.forgotPassword(email);
      if (response.success) {
        setSuccess(true);
      } else {
        setError(response.error || t('forgotPasswordPage.sendFailedDefault'));
      }
    } catch {
      // Always show success to prevent email enumeration
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Container size={420} my={40}>
        <Paper withBorder shadow="md" p={30} radius="md">
          <Stack align="center" gap="md">
            <IconCheck size={48} color="var(--mantine-color-green-6)" />
            <Title order={2} ta="center">{t('loginPage.checkEmailTitle')}</Title>
            <Text c="dimmed" ta="center">
              {t('forgotPasswordPage.ifAccountExistsPrefix')} <strong>{email}</strong>{t('forgotPasswordPage.ifAccountExistsSuffix')}
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('forgotPasswordPage.linkExpire1Hour')}
            </Text>
            <Button component={Link} to="/login" variant="light">
              {t('loginPage.backToLogin')}
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size={420} my={40}>
      <Title ta="center">{t('forgotPasswordPage.title')}</Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        {t('forgotPasswordPage.subtitle')}
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {error && (
              <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
                {error}
              </Alert>
            )}

            <TextInput
              label={t('loginPage.emailLabel')}
              placeholder={t('loginPage.emailPlaceholder')}
              leftSection={<IconMail size={16} />}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              required
            />

            <Button type="submit" fullWidth loading={loading}>
              {t('forgotPasswordPage.sendResetLink')}
            </Button>

            <Text size="sm" ta="center">
              <Anchor component={Link} to="/login" size="sm">
                {t('forgotPasswordPage.backToLoginLink')}
              </Anchor>
            </Text>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
