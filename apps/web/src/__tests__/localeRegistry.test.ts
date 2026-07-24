import { describe, expect, it } from 'vitest';
import { buildLocaleRegistry } from '../i18n/registry';

const VALID_MODULES = {
  './locales/fr.json': {
    _meta: { languageName: 'Français' },
    greeting: 'Bonjour',
  },
  './locales/en.json': {
    _meta: { languageName: 'English' },
    greeting: 'Hello',
  },
  './locales/de.json': {
    _meta: { languageName: 'Deutsch' },
    greeting: 'Hallo',
  },
};

describe('locale registry', () => {
  it('discovers synthetic locale modules with English first and other codes sorted', () => {
    const registry = buildLocaleRegistry(VALID_MODULES);

    expect(registry.supportedLanguages).toEqual(['en', 'de', 'fr']);
    expect(registry.languageOptions).toEqual([
      { value: 'en', label: 'English' },
      { value: 'de', label: 'Deutsch' },
      { value: 'fr', label: 'Français' },
    ]);
  });

  it('strips catalog metadata from i18next resources', () => {
    const registry = buildLocaleRegistry(VALID_MODULES);

    expect(registry.resources['fr']).toEqual({
      translation: { greeting: 'Bonjour' },
    });
    expect(registry.resources['fr']?.translation).not.toHaveProperty('_meta');
  });

  it('rejects registries without the English fallback catalog', () => {
    expect(() =>
      buildLocaleRegistry({
        './locales/de.json': VALID_MODULES['./locales/de.json'],
        './locales/fr.json': VALID_MODULES['./locales/fr.json'],
      })
    ).toThrow(/English fallback catalog.*en\.json/);
  });

  it.each([
    './locales/EN.json',
    './locales/e.json',
    './locales/french.json',
  ])('rejects invalid locale filename %s', (modulePath) => {
    expect(() =>
      buildLocaleRegistry({
        './locales/en.json': VALID_MODULES['./locales/en.json'],
        [modulePath]: { _meta: { languageName: 'Invalid' } },
      })
    ).toThrow(/lowercase 2-3 letter language code/);
  });

  it.each([undefined, '', '   '])(
    'rejects missing or empty language metadata %#',
    (languageName) => {
      expect(() =>
        buildLocaleRegistry({
          './locales/en.json': VALID_MODULES['./locales/en.json'],
          './locales/fr.json': { _meta: { languageName } },
        })
      ).toThrow(/non-empty _meta.languageName/);
    }
  );
});
