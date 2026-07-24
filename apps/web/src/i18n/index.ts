import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { setFormattingLanguage } from '../lib/currency';
import { buildLocaleRegistry, normalizeSupportedLanguage } from './registry';

export { normalizeSupportedLanguage } from './registry';

const localeModules = import.meta.glob('./locales/*.json', {
  eager: true,
  import: 'default',
});
const localeRegistry = buildLocaleRegistry(localeModules);

export const SUPPORTED_LANGUAGES = localeRegistry.supportedLanguages;
export const LANGUAGE_OPTIONS = localeRegistry.languageOptions;
export const TRANSLATION_CATALOGS = localeRegistry.catalogs;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'billmanager:language';

export function isSupportedLanguage(language: string): language is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(language);
}

function getStoredLanguage(): SupportedLanguage | null {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && isSupportedLanguage(stored) ? stored : null;
}

function updateDocumentMetadata(language: SupportedLanguage): void {
  document.documentElement.lang = language;

  const description = i18n.t('meta.description', { lng: language });
  document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  document
    .querySelector('meta[property="og:description"]')
    ?.setAttribute('content', description);

  const manifest = document.querySelector('link[rel="manifest"]');
  manifest?.setAttribute(
    'href',
    language === 'de' ? '/manifest.de.json' : '/manifest.json'
  );
}

const initialLanguage = getStoredLanguage() ?? 'en';

i18n.on('languageChanged', (language) => {
  const supportedLanguage = normalizeSupportedLanguage(language, SUPPORTED_LANGUAGES);
  setFormattingLanguage(supportedLanguage);
  updateDocumentMetadata(supportedLanguage);
});

void i18n
  .use(initReactI18next)
  .init({
    resources: localeRegistry.resources,
    lng: initialLanguage,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    load: 'languageOnly',
    interpolation: {
      escapeValue: false,
    },
  })
  .then(() =>
    updateDocumentMetadata(normalizeSupportedLanguage(i18n.language, SUPPORTED_LANGUAGES))
  );

export function setLanguage(language: SupportedLanguage): void {
  window.localStorage.setItem(STORAGE_KEY, language);
  void i18n.changeLanguage(language);
}

/**
 * Applies DEFAULT_LOCALE as the initial UI language unless the user has an
 * explicit browser preference from the Settings language switcher.
 */
export function applyLocaleDefault(locale: string): void {
  const storedLanguage = getStoredLanguage();
  if (storedLanguage) {
    return;
  }

  const language = normalizeSupportedLanguage(locale, SUPPORTED_LANGUAGES);
  void i18n.changeLanguage(language);
}

export default i18n;
