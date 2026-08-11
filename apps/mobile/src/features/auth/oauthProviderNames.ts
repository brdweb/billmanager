const WELL_KNOWN_PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  microsoft: 'Microsoft',
  oidc: 'SSO',
};

export function oauthProviderDisplayName(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (WELL_KNOWN_PROVIDER_NAMES[normalized]) {
    return WELL_KNOWN_PROVIDER_NAMES[normalized];
  }
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatOAuthProviderNames(providerIds: string[]): string {
  return Array.from(new Set(providerIds.map(oauthProviderDisplayName).filter(Boolean))).join(', ');
}
