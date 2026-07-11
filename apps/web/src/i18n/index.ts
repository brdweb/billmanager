import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { setFormattingLanguage } from '../lib/currency';
import en from './locales/en.json';
import de from './locales/de.json';

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'billmanager:language';

function isSupportedLanguage(language: string): language is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language);
}

function normalizeLanguage(language: string): SupportedLanguage {
  const normalized = language.split(/[-_]/)[0].toLowerCase();
  return isSupportedLanguage(normalized) ? normalized : 'en';
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
  const supportedLanguage = normalizeLanguage(language);
  setFormattingLanguage(supportedLanguage);
  updateDocumentMetadata(supportedLanguage);
});

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
    },
    lng: initialLanguage,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    load: 'languageOnly',
    interpolation: {
      escapeValue: false,
    },
  })
  .then(() => updateDocumentMetadata(normalizeLanguage(i18n.language)));

export function setLanguage(language: SupportedLanguage): void {
  window.localStorage.setItem(STORAGE_KEY, language);
  void i18n.changeLanguage(language);
}

/**
 * Applies DEFAULT_LOCALE as the initial UI language unless the user has an
 * explicit browser preference from the Settings language switcher.
 */
export function applyLocaleDefault(locale: string): void {
  if (getStoredLanguage()) return;

  const language = normalizeLanguage(locale);
  void i18n.changeLanguage(language);
}

export default i18n;
