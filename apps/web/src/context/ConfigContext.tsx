import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import * as api from '../api/client';
import { setCurrencyConfig } from '../lib/currency';
import i18n, { applyLocaleDefault } from '../i18n';

export interface OAuthProviderInfo {
  id: string;
  display_name: string;
  icon: string;
}

export interface AppConfig {
  deployment_mode: 'saas' | 'self-hosted';
  billing_enabled: boolean;
  registration_enabled: boolean;
  email_enabled: boolean;
  email_verification_required: boolean;
  oauth_providers?: OAuthProviderInfo[];
  twofa_enabled?: boolean;
  passkeys_enabled?: boolean;
  default_currency?: string;
  default_locale?: string;
}

interface ConfigContextType {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;
  isSaas: boolean;
  isSelfHosted: boolean;
  emailEnabled: boolean;
  billingEnabled: boolean;
  registrationEnabled: boolean;
  currency: string;
  locale: string;
  refetch: () => Promise<void>;
}

const defaultConfig: AppConfig = {
  deployment_mode: 'self-hosted',
  billing_enabled: false,
  registration_enabled: false,
  email_enabled: false,
  email_verification_required: false,
  oauth_providers: [],
  twofa_enabled: false,
  passkeys_enabled: false,
  default_currency: 'USD',
  default_locale: 'en-US',
};

const ConfigContext = createContext<ConfigContextType>({
  config: null,
  loading: true,
  error: null,
  isSaas: false,
  isSelfHosted: true,
  emailEnabled: false,
  billingEnabled: false,
  registrationEnabled: false,
  currency: 'USD',
  locale: 'en-US',
  refetch: async () => {},
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = async () => {
    try {
      const response = await api.getAppConfig();
      setConfig(response);
      setCurrencyConfig(
        response.default_locale ?? 'en-US',
        response.default_currency ?? 'USD'
      );
      applyLocaleDefault(response.default_locale ?? 'en-US');
      setError(null);
    } catch (err) {
      console.error('Failed to fetch app config:', err);
      // Fall back to default config on error
      setConfig(defaultConfig);
      setError(i18n.t('apiErrors.configLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const value: ConfigContextType = {
    config,
    loading,
    error,
    isSaas: config?.deployment_mode === 'saas',
    isSelfHosted: config?.deployment_mode === 'self-hosted',
    emailEnabled: config?.email_enabled ?? false,
    billingEnabled: config?.billing_enabled ?? false,
    registrationEnabled: config?.registration_enabled ?? false,
    currency: config?.default_currency ?? 'USD',
    locale: config?.default_locale ?? 'en-US',
    refetch: fetchConfig,
  };

  return (
    <ConfigContext.Provider value={value}>
      {children}
    </ConfigContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
