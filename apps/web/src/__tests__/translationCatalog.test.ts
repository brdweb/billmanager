import { describe, expect, it } from 'vitest';
import { TRANSLATION_CATALOGS } from '../i18n';

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  if (!value || typeof value !== 'object') return {};

  return Object.entries(value).reduce<Record<string, string>>(
    (result, [key, child]) => ({
      ...result,
      ...flatten(child, prefix ? `${prefix}.${key}` : key),
    }),
    {}
  );
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+).*?}}/g)]
    .map((match) => match[1])
    .sort();
}

describe('translation catalogs', () => {
  const english = flatten(TRANSLATION_CATALOGS['en']);
  const discoveredCatalogs = Object.entries(TRANSLATION_CATALOGS);

  it('has the same keys in every discovered catalog', () => {
    for (const [language, catalog] of discoveredCatalogs) {
      expect(Object.keys(flatten(catalog)).sort(), language).toEqual(
        Object.keys(english).sort()
      );
    }
  });

  it('uses the same interpolation placeholders in every discovered catalog', () => {
    for (const [language, catalog] of discoveredCatalogs) {
      const translations = flatten(catalog);
      for (const key of Object.keys(english)) {
        expect(placeholders(translations[key]), `${language}:${key}`).toEqual(
          placeholders(english[key])
        );
      }
    }
  });

  it('does not contain empty translations in discovered catalogs', () => {
    for (const [language, catalog] of discoveredCatalogs) {
      expect(
        Object.entries(flatten(catalog)).filter(([, value]) => !value.trim()),
        language
      ).toEqual([]);
    }
  });
});
