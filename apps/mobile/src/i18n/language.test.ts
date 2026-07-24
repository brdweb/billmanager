import { describe, expect, it } from 'vitest';

import { getLanguageOption, normalizeLanguageFrom } from './language';

describe('language normalization', () => {
  it('normalizes a regional locale against supplied generated codes', () => {
    // Given
    const generatedCodes = ['en', 'fr'] as const;

    // When
    const language = normalizeLanguageFrom('fr-CA', generatedCodes, 'en');

    // Then
    expect(language).toBe('fr');
  });

  it('falls back to English when the locale is unsupported', () => {
    // Given
    const generatedCodes = ['en', 'de'] as const;

    // When
    const language = normalizeLanguageFrom('es-MX', generatedCodes, 'en');

    // Then
    expect(language).toBe('en');
  });

  it('resolves selector copy from generated language options', () => {
    // Given / When
    const option = getLanguageOption('de');

    // Then
    expect(option).toEqual({ code: 'de', label: 'Deutsch' });
  });
});
