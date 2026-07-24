import { describe, expect, it } from 'vitest';
import {
  MobileContractError,
  parseServerCapabilities,
} from './capabilities';

describe('server capability negotiation', () => {
  it('maps the pre-auth mobile envelope to stable client capabilities', () => {
    expect(parseServerCapabilities({
      success: true,
      data: {
        default_currency: 'EUR',
        default_locale: 'de-DE',
        mobile: {
          mobile_contract_version: 1,
          server_version: '4.4.0',
          minimum_mobile_version: '1.0.0',
          oauth_providers: ['oidc'],
          features: {
            registration: true,
            email_otp: true,
            passkeys: true,
            billing: false,
            administration: true,
            sharing: true,
            settlements: true,
          },
        },
      },
    })).toEqual({
      mobileContractVersion: 1,
      serverVersion: '4.4.0',
      minimumMobileVersion: '1.0.0',
      defaultCurrency: 'EUR',
      supportedCurrencies: ['EUR'],
      defaultLocale: 'de-DE',
      registration: true,
      oauthProviders: ['oidc'],
      emailOtp: true,
      passkeys: true,
      billing: false,
      administration: true,
      sharing: true,
      settlements: true,
    });
  });

  it('turns an old self-hosted server into an actionable compatibility error', () => {
    expect(() => parseServerCapabilities({ success: true, data: {} })).toThrowError(
      MobileContractError,
    );
    expect(() => parseServerCapabilities({ success: true, data: {} })).toThrow(
      'Upgrade the server',
    );
  });

  it('rejects a newer breaking contract instead of guessing compatibility', () => {
    const readFutureContract = () => parseServerCapabilities({
      success: true,
      data: {
        mobile: {
          mobile_contract_version: 2,
          server_version: '5.0.0',
        },
      },
    });

    expect(readFutureContract).toThrowError(MobileContractError);
    expect(readFutureContract).toThrow('Update BillManager Mobile');
    try {
      readFutureContract();
    } catch (reason) {
      expect(reason).toMatchObject({
        code: 'unsupported_contract',
        contractVersion: 2,
      });
    }
  });
});
