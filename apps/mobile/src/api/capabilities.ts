import { ServerCapabilities } from '../domain/serverProfile';

interface PublicConfigEnvelope {
  success?: boolean;
  data?: PublicConfig;
}

interface PublicConfig {
  deployment_mode?: string;
  billing_enabled?: boolean;
  registration_enabled?: boolean;
  twofa_enabled?: boolean;
  passkeys_enabled?: boolean;
  default_currency?: string;
  default_locale?: string;
  supported_currencies?: string[];
  oauth_providers?: Array<string | { id?: string }>;
  mobile?: MobileCapabilityEnvelope;
}

interface MobileCapabilityEnvelope {
  mobile_contract_version?: number;
  server_version?: string;
  minimum_mobile_version?: string | null;
  default_currency?: string;
  default_locale?: string;
  oauth_providers?: string[];
  features?: Record<string, boolean | undefined>;
}

export const minimumSupportedMobileContract = 1;
export const maximumSupportedMobileContract = 1;

export class MobileContractError extends Error {
  constructor(
    message: string,
    public readonly code: 'missing_contract' | 'unsupported_contract',
    public readonly contractVersion: number | null = null,
  ) {
    super(message);
    this.name = 'MobileContractError';
  }
}

function providerIds(config: PublicConfig, mobile: MobileCapabilityEnvelope): string[] {
  if (Array.isArray(mobile.oauth_providers)) return mobile.oauth_providers;
  return (config.oauth_providers ?? [])
    .map((provider) => typeof provider === 'string' ? provider : provider.id)
    .filter((provider): provider is string => Boolean(provider));
}

export function parseServerCapabilities(payload: unknown): ServerCapabilities {
  const envelope = payload as PublicConfigEnvelope;
  const config = envelope?.data ?? (payload as PublicConfig);
  const mobile = config?.mobile;
  if (!mobile || typeof mobile.mobile_contract_version !== 'number') {
    throw new MobileContractError(
      'This server does not advertise a compatible BillManager mobile contract. Upgrade the server and try again.',
      'missing_contract',
    );
  }
  if (mobile.mobile_contract_version < minimumSupportedMobileContract) {
    throw new MobileContractError(
      `This server uses mobile contract ${mobile.mobile_contract_version}; update the server to contract ${minimumSupportedMobileContract}.`,
      'unsupported_contract',
      mobile.mobile_contract_version,
    );
  }
  if (mobile.mobile_contract_version > maximumSupportedMobileContract) {
    throw new MobileContractError(
      `This server uses mobile contract ${mobile.mobile_contract_version}; this app supports contract ${maximumSupportedMobileContract}. Update BillManager Mobile to continue.`,
      'unsupported_contract',
      mobile.mobile_contract_version,
    );
  }

  const features = mobile.features ?? {};
  return {
    mobileContractVersion: mobile.mobile_contract_version,
    serverVersion: mobile.server_version ?? 'unknown',
    minimumMobileVersion: mobile.minimum_mobile_version ?? null,
    defaultCurrency: mobile.default_currency ?? config.default_currency ?? 'USD',
    supportedCurrencies: config.supported_currencies ?? [mobile.default_currency ?? config.default_currency ?? 'USD'],
    defaultLocale: mobile.default_locale ?? config.default_locale ?? 'en-US',
    registration: features.registration ?? config.registration_enabled ?? false,
    oauthProviders: providerIds(config, mobile),
    emailOtp: features.email_otp ?? config.twofa_enabled ?? false,
    passkeys: features.passkeys ?? config.passkeys_enabled ?? false,
    billing: features.billing ?? config.billing_enabled ?? false,
    administration: features.administration ?? false,
    sharing: features.sharing ?? false,
    settlements: features.settlements ?? false,
  };
}
