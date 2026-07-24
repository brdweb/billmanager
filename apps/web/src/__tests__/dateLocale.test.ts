import { describe, expect, it, vi } from 'vitest';
import { normalizeSupportedLanguage } from '../i18n';
import {
  loadDateLocale,
  resolveDateLocale,
  type DateLocaleLoader,
} from '../i18n/dateLocale';

const ENGLISH_LOADER: DateLocaleLoader = async () => ({
  default: { name: 'en' },
});

describe('date locale resolution', () => {
  it('normalizes a synthetic discovered regional language to its base code', () => {
    const language = normalizeSupportedLanguage('FR-ca', ['en', 'de', 'fr']);

    expect(language).toBe('fr');
  });

  it('keeps a synthetic discovered language when dayjs provides its locale', () => {
    const locale = resolveDateLocale('fr-FR', ['en', 'de', 'fr'], {
      en: ENGLISH_LOADER,
      fr: async () => ({ default: { name: 'fr', weekStart: 1 } }),
    });

    expect(locale.locale).toBe('fr');
  });

  it('loads week metadata for a synthetic discovered language', async () => {
    const frenchLoader = vi.fn(async () => ({
      default: { name: 'fr', weekStart: 1 },
    }));
    const loaders = { en: ENGLISH_LOADER, fr: frenchLoader };
    const resolved = resolveDateLocale('fr', ['en', 'fr'], loaders);

    const locale = await loadDateLocale(resolved, loaders);

    expect(locale).toEqual({ locale: 'fr', firstDayOfWeek: 1 });
    expect(frenchLoader).toHaveBeenCalledOnce();
  });

  it('falls back to English when dayjs lacks the discovered locale', () => {
    const locale = resolveDateLocale('fr', ['en', 'fr'], {
      en: ENGLISH_LOADER,
    });

    expect(locale).toEqual({ locale: 'en', firstDayOfWeek: 0 });
  });

  it.each([
    ['en', 0],
    ['de', 1],
  ] as const)('preserves the %s week start', (language, firstDayOfWeek) => {
    const locale = resolveDateLocale(language, ['en', 'de'], {
      en: ENGLISH_LOADER,
      de: async () => ({ default: { name: 'de', weekStart: 1 } }),
    });

    expect(locale.firstDayOfWeek).toBe(firstDayOfWeek);
  });
});
