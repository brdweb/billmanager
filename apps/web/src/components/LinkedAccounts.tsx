import { useState, useEffect, useCallback } from 'react';
import {
  Stack,
  Title,
  Text,
  Group,
  Paper,
  Badge,
  Button,
  Alert,
  Loader,
} from '@mantine/core';
import {
  IconLink,
  IconBrandGoogle,
  IconBrandApple,
  IconBrandWindows,
  IconLock,
  IconAlertCircle,
  IconUnlink,
} from '@tabler/icons-react';
import { useConfig } from '../context/ConfigContext';
import * as api from '../api/client';

const providerIcons: Record<string, React.ReactNode> = {
  google: <IconBrandGoogle size={20} />,
  apple: <IconBrandApple size={20} />,
  microsoft: <IconBrandWindows size={20} />,
  oidc: <IconLock size={20} />,
};

const providerNames: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  microsoft: 'Microsoft',
  oidc: 'SSO',
};

export function LinkedAccounts() {
  const { config } = useConfig();
  const [accounts, setAccounts] = useState<api.OAuthAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const hasProviders = config?.oauth_providers && config.oauth_providers.length > 0;

  const fetchAccounts = useCallback(async () => {
    try {
      const result = await api.getOAuthAccounts();
      setAccounts(result);
    } catch {
      setError('Failed to load linked accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasProviders) {
      fetchAccounts();
    } else {
      setLoading(false);
    }
  }, [hasProviders, fetchAccounts]);

  if (!hasProviders) {
    return null;
  }

  const handleUnlink = async (provider: string) => {
    setUnlinking(provider);
    setError('');
    try {
      await api.unlinkOAuthProvider(provider);
      await fetchAccounts();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || 'Failed to unlink account');
    } finally {
      setUnlinking(null);
    }
  };

  const handleLink = async (providerId: string) => {
    try {
      const result = await api.getOAuthAuthorizeUrl(providerId);
      sessionStorage.setItem('oauth_state', result.state);
      sessionStorage.setItem('oauth_provider', providerId);
      window.location.assign(result.auth_url);
    } catch {
      setError('Failed to start linking process');
    }
  };

  if (loading) {
    return <Loader size="sm" />;
  }

  const linkedProviders = new Set(accounts.map((a) => a.provider));

  return (
    <Stack gap="md">
      <Group>
        <IconLink size={24} />
        <Title order={4}>Linked Accounts</Title>
      </Group>

      <Text size="sm" c="dimmed">
        Connect external accounts for faster sign-in.
      </Text>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" withCloseButton onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {config?.oauth_providers?.map((provider) => {
        const linked = linkedProviders.has(provider.id);
        const account = accounts.find((a) => a.provider === provider.id);

        return (
          <Paper key={provider.id} withBorder p="md">
            <Group justify="space-between">
              <Group>
                {providerIcons[provider.id] || <IconLock size={20} />}
                <div>
                  <Text fw={500}>{providerNames[provider.id] || provider.display_name}</Text>
                  {account?.provider_email && (
                    <Text size="xs" c="dimmed">{account.provider_email}</Text>
                  )}
                </div>
              </Group>
              {linked ? (
                <Group gap="xs">
                  <Badge color="green" variant="light">Connected</Badge>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconUnlink size={14} />}
                    onClick={() => handleUnlink(provider.id)}
                    loading={unlinking === provider.id}
                  >
                    Unlink
                  </Button>
                </Group>
              ) : (
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => handleLink(provider.id)}
                >
                  Connect
                </Button>
              )}
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
