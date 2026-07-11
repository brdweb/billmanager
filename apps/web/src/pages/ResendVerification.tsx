import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
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

export function ResendVerification() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialEmail = searchParams.get('email') || '';

  const [email, setEmail] = useState(initialEmail);
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
      setError(t('resendVerificationPage.invalidEmail'));
      return;
    }

    setLoading(true);
    try {
      const response = await api.resendVerification(email);
      if (response.success) {
        setSuccess(true);
      } else {
        setError(response.error || t('resendVerificationPage.resendFailedDefault'));
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || t('resendVerificationPage.resendFailedDefault'));
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
            <Title order={2} ta="center">{t('resendVerificationPage.emailSentTitle')}</Title>
            <Text c="dimmed" ta="center">
              {t('resendVerificationPage.weSentNewLinkPrefix')} <strong>{email}</strong>{t('resendVerificationPage.weSentNewLinkSuffix')}
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              {t('resendVerificationPage.linkExpire24h')}
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
      <Title ta="center">{t('resendVerificationPage.title')}</Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        {t('resendVerificationPage.subtitle')}
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
              {t('resendVerificationPage.resendButton')}
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
