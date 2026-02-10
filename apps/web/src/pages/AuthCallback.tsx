import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Center, Loader, Stack, Text, Alert, Button, Box } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';

export function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithOAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const errorParam = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      if (errorParam) {
        setError(errorDescription || errorParam || 'Authentication was cancelled');
        return;
      }

      if (!code || !state) {
        setError('Missing authorization code or state');
        return;
      }

      // Get the provider from sessionStorage
      const provider = sessionStorage.getItem('oauth_provider');
      const storedState = sessionStorage.getItem('oauth_state');

      if (!provider) {
        setError('Missing OAuth provider info. Please try signing in again.');
        return;
      }

      if (storedState !== state) {
        setError('State mismatch - possible CSRF attack. Please try again.');
        return;
      }

      // Clean up sessionStorage
      sessionStorage.removeItem('oauth_state');
      sessionStorage.removeItem('oauth_provider');

      try {
        const result = await loginWithOAuth(provider, code, state);
        if (result.success && !result.require2FA) {
          navigate('/', { replace: true });
        }
        // If require2FA, AuthContext will set pending2FA and the Login/TwoFactorVerify
        // page will render the 2FA UI
        if (result.require2FA) {
          navigate('/login', { replace: true });
        }
      } catch {
        setError('Failed to complete sign-in. Please try again.');
      }
    };

    handleCallback();
  }, [searchParams, loginWithOAuth, navigate]);

  if (error) {
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
        <Stack gap="lg" align="center" maw={400}>
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Sign-in Failed">
            {error}
          </Alert>
          <Button onClick={() => navigate('/login', { replace: true })} variant="white">
            Back to Login
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Center h="100vh" style={{ background: 'linear-gradient(135deg, #059669 0%, #064e3b 100%)' }}>
      <Stack gap="md" align="center">
        <Loader size="xl" color="white" />
        <Text c="white" size="lg">Completing sign-in...</Text>
      </Stack>
    </Center>
  );
}
