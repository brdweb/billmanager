import { describe, expect, it } from 'vitest';

import { SUPPORTED_LANGUAGES } from './generated';
import { createI18nResources, resources } from './resources';

describe('i18n resources', () => {
  it('keeps shared catalog copy for a future locale and falls mobile copy back to English', () => {
    // Given
    const catalogs = {
      en: { _meta: { languageName: 'English' }, shared: { heading: 'Shared in English' } },
      fr: { _meta: { languageName: 'Français' }, shared: { heading: 'Partagé en français' } },
    } as const;
    const mobileNamespaces = {
      mobileOnly: {
        en: { heading: 'Mobile in English' },
        de: { heading: 'Mobil auf Deutsch' },
      },
    } as const;

    // When
    const resources = createI18nResources(catalogs, mobileNamespaces);

    // Then
    expect(resources.fr?.translation.shared).toEqual({ heading: 'Partagé en français' });
    expect(resources.fr?.translation.mobileOnly).toEqual({ heading: 'Mobile in English' });
  });

  it('uses localized mobile copy when it exists and strips catalog metadata', () => {
    // Given
    const catalogs = {
      en: { _meta: { languageName: 'English' }, shared: { heading: 'English' } },
      de: { _meta: { languageName: 'Deutsch' }, shared: { heading: 'Deutsch' } },
    } as const;
    const mobileNamespaces = {
      mobileOnly: {
        en: { heading: 'Mobile in English' },
        de: { heading: 'Mobil auf Deutsch' },
      },
    } as const;

    // When
    const resources = createI18nResources(catalogs, mobileNamespaces);

    // Then
    expect(resources.de?.translation.mobileOnly).toEqual({ heading: 'Mobil auf Deutsch' });
    expect(resources.en?.translation).not.toHaveProperty('_meta');
    expect(resources.de?.translation).not.toHaveProperty('_meta');
  });

  it('builds one registered resource for every generated locale', () => {
    // Given / When
    const registeredLanguages = Object.keys(resources);

    // Then
    expect(registeredLanguages).toEqual([...SUPPORTED_LANGUAGES]);
  });
});
