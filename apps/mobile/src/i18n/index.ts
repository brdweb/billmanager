import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import Storage from 'expo-sqlite/kv-store';

import {
  getLanguageOption,
  LANGUAGE_OPTIONS,
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from './language';
import { resources } from './resources';

export {
  getLanguageOption,
  LANGUAGE_OPTIONS,
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from './language';

const LANGUAGE_STORAGE_KEY = 'billmanager:language';

const deviceLanguage = normalizeLanguage(getLocales()[0]?.languageTag);

void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage,
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LANGUAGES],
  load: 'languageOnly',
  returnNull: false,
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

export async function hydrateLanguage(defaultLocale?: string): Promise<SupportedLanguage> {
  const stored = await Storage.getItem(LANGUAGE_STORAGE_KEY);
  const language = normalizeLanguage(stored ?? defaultLocale ?? deviceLanguage);
  await i18n.changeLanguage(language);
  return language;
}

export async function setLanguage(language: SupportedLanguage): Promise<void> {
  try {
    await Storage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error('Failed to persist language preference:', error);
  }
  await i18n.changeLanguage(language);
}

export default i18n;
