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
import * as api from '../api/client';

export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('error');
      setMessage('Invalid verification link. No token provided.');
      return;
    }

    const verify = async () => {
      try {
        const response = await api.verifyEmail(token);
        if (response.success) {
          setStatus('success');
          setMessage(response.message || 'Your email has been verified!');
        } else {
          setStatus('error');
          setMessage(response.error || 'Verification failed');
        }
      } catch (err: unknown) {
        const error = err as { response?: { data?: { error?: string } } };
        setStatus('error');
        setMessage(error.response?.data?.error || 'Verification failed. The link may have expired.');
      }
    };

    verify();
  }, [token]);

  return (
    <Container size={420} my={40}>
      <Paper withBorder shadow="md" p={30} radius="md">
        {status === 'loading' && (
          <Center py="xl">
            <Stack align="center" gap="md">
              <Loader size="lg" />
              <Text>Verifying your email...</Text>
            </Stack>
          </Center>
        )}

        {status === 'success' && (
          <Stack align="center" gap="md">
            <IconCheck size={64} color="var(--mantine-color-green-6)" />
            <Title order={2} ta="center">Email Verified!</Title>
            <Text c="dimmed" ta="center">{message}</Text>
            <Text ta="center">
              Your account is now active. You can start using BillManager to track your bills and income.
            </Text>
            <Button component={Link} to="/login" fullWidth>
              Sign In
            </Button>
          </Stack>
        )}

        {status === 'error' && (
          <Stack align="center" gap="md">
            <IconX size={64} color="var(--mantine-color-red-6)" />
            <Title order={2} ta="center">Verification Failed</Title>
            <Text c="dimmed" ta="center">{message}</Text>
            <Text size="sm" ta="center">
              If your verification link has expired, you can request a new one.
            </Text>
            <Stack w="100%" gap="xs">
              <Button component={Link} to="/resend-verification" variant="light" fullWidth>
                Resend Verification Email
              </Button>
              <Button component={Link} to="/login" variant="subtle" fullWidth>
                Back to Login
              </Button>
            </Stack>
          </Stack>
        )}
      </Paper>
    </Container>
  );
}
