import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Container,
  Paper,
  Title,
  Text,
  Button,
  Stack,
  Loader,
  Center,
} from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import * as api from '../api/client';

export function VerifyEmail() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage(t('verifyEmailPage.invalidLink'));
      return;
    }

    const verify = async () => {
      try {
        const response = await api.verifyEmail(token);
        if (response.success) {
          setStatus('success');
          setMessage(response.message || t('verifyEmailPage.verifiedDefault'));
        } else {
          setStatus('error');
          setMessage(response.error || t('verifyEmailPage.verificationFailedDefault'));
        }
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: string } } };
        setStatus('error');
        setMessage(error.response?.data?.error || t('verifyEmailPage.verificationFailedExpired'));
      }
    };

    verify();
  }, [token, t]);

  return (
    <Container size={420} my={40}>
      <Paper withBorder shadow="md" p={30} radius="md">
        {status === 'loading' && (
          <Center py="xl">
            <Stack align="center" gap="md">
              <Loader size="lg" />
              <Text>{t('verifyEmailPage.verifyingEmail')}</Text>
            </Stack>
          </Center>
        )}

        {status === 'success' && (
          <Stack align="center" gap="md">
            <IconCheck size={64} color="var(--mantine-color-green-6)" />
            <Title order={2} ta="center">{t('verifyEmailPage.emailVerifiedTitle')}</Title>
            <Text c="dimmed" ta="center">{message}</Text>
            <Text ta="center">
              {t('verifyEmailPage.accountActiveBody')}
            </Text>
            <Button component={Link} to="/login" fullWidth>
              {t('loginPage.signIn')}
            </Button>
          </Stack>
        )}

        {status === 'error' && (
          <Stack align="center" gap="md">
            <IconX size={64} color="var(--mantine-color-red-6)" />
            <Title order={2} ta="center">{t('verifyEmailPage.verificationFailedTitle')}</Title>
            <Text c="dimmed" ta="center">{message}</Text>
            <Text size="sm" ta="center">
              {t('verifyEmailPage.expiredNotice')}
            </Text>
            <Stack w="100%" gap="xs">
              <Button component={Link} to="/resend-verification" variant="light" fullWidth>
                {t('resendVerificationPage.resendButton')}
              </Button>
              <Button component={Link} to="/login" variant="subtle" fullWidth>
                {t('loginPage.backToLogin')}
              </Button>
            </Stack>
          </Stack>
        )}
      </Paper>
    </Container>
  );
}
