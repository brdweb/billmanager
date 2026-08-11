import { describe, expect, it } from 'vitest';

import { shouldDeferInitialReady } from './initialProfileReadiness';

describe('initial profile readiness', () => {
  it('waits for live capabilities on a fresh installation', () => {
    expect(shouldDeferInitialReady({ capabilities: null })).toBe(true);
  });

  it('allows a cached compatible profile to render while it refreshes', () => {
    const capabilities = {
      mobileContractVersion: 1,
      serverVersion: '4.7.4',
      minimumMobileVersion: null,
      defaultCurrency: 'USD',
      supportedCurrencies: ['USD'],
      defaultLocale: 'en-US',
      registration: true,
      oauthProviders: ['google'],
      emailOtp: true,
      passkeys: true,
      billing: true,
      administration: true,
      sharing: true,
      settlements: true,
    };

    expect(shouldDeferInitialReady({ capabilities })).toBe(false);
  });
});
