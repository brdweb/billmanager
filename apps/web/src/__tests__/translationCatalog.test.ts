import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';

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
  const english = flatten(en);
  const german = flatten(de);

  it('has the same keys in English and German', () => {
    expect(Object.keys(german).sort()).toEqual(Object.keys(english).sort());
  });

  it('uses the same interpolation placeholders in both languages', () => {
    for (const key of Object.keys(english)) {
      expect(placeholders(german[key]), key).toEqual(placeholders(english[key]));
    }
  });

  it('does not contain empty translations', () => {
    expect(Object.entries(english).filter(([, value]) => !value.trim())).toEqual([]);
    expect(Object.entries(german).filter(([, value]) => !value.trim())).toEqual([]);
  });
});
