import { Button, Stack, Divider, Text } from '@mantine/core';
import {
  IconBrandGoogle,
  IconBrandApple,
  IconBrandWindows,
  IconLock,
} from '@tabler/icons-react';
import type { OAuthProviderInfo } from '../context/ConfigContext';
import * as api from '../api/client';

const providerIcons: Record<string, React.ReactNode> = {
  google: <IconBrandGoogle size={18} />,
  apple: <IconBrandApple size={18} />,
  microsoft: <IconBrandWindows size={18} />,
  lock: <IconLock size={18} />,
};

const providerColors: Record<string, string> = {
  google: '#4285F4',
  apple: '#000000',
  microsoft: '#00A4EF',
};

interface SocialLoginButtonsProps {
  providers: OAuthProviderInfo[];
  loading?: boolean;
  onError?: (error: string) => void;
}

export function SocialLoginButtons({ providers, loading, onError }: SocialLoginButtonsProps) {
  if (!providers || providers.length === 0) return null;

  const handleOAuthLogin = async (provider: OAuthProviderInfo) => {
    try {
      const result = await api.getOAuthAuthorizeUrl(provider.id);
      // Store state in sessionStorage for callback verification
      sessionStorage.setItem('oauth_state', result.state);
      sessionStorage.setItem('oauth_provider', provider.id);
      // Redirect to provider
      window.location.assign(result.auth_url);
    } catch {
      onError?.('Failed to start sign-in. Please try again.');
    }
  };

  return (
    <>
      <Divider
        label={<Text size="xs" c="dimmed">or continue with</Text>}
        labelPosition="center"
        my="md"
      />
      <Stack gap="xs">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            variant="default"
            fullWidth
            leftSection={providerIcons[provider.icon] || providerIcons.lock}
            onClick={() => handleOAuthLogin(provider)}
            loading={loading}
            styles={{
              root: {
                borderColor: providerColors[provider.id] ? `${providerColors[provider.id]}40` : undefined,
              },
            }}
          >
            Sign in with {provider.display_name}
          </Button>
        ))}
      </Stack>
    </>
  );
}
