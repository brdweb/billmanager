import { describe, expect, it } from 'vitest';

import { formatOAuthProviderNames, oauthProviderDisplayName } from './oauthProviderNames';

describe('OAuth provider names', () => {
  it('uses recognizable names for the built-in providers', () => {
    expect(formatOAuthProviderNames(['google', 'apple', 'microsoft'])).toBe('Google, Apple, Microsoft');
    expect(oauthProviderDisplayName('oidc')).toBe('SSO');
  });

  it('formats custom provider identifiers and removes duplicates', () => {
    expect(formatOAuthProviderNames(['company-login', 'company-login'])).toBe('Company Login');
  });
});
