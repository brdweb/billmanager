import { LANGUAGE_OPTIONS, SUPPORTED_LANGUAGES } from './generated';

export { LANGUAGE_OPTIONS, SUPPORTED_LANGUAGES } from './generated';

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function normalizeLanguageFrom<Language extends string>(
  language: string | null | undefined,
  supportedLanguages: readonly Language[],
  fallbackLanguage: Language,
): Language {
  const normalized = language?.split(/[-_]/)[0]?.toLowerCase();
  return supportedLanguages.find((supportedLanguage) => supportedLanguage === normalized)
    ?? fallbackLanguage;
}

export function normalizeLanguage(language?: string | null): SupportedLanguage {
  return normalizeLanguageFrom(language, SUPPORTED_LANGUAGES, 'en');
}

export function getLanguageOption(language: SupportedLanguage) {
  return LANGUAGE_OPTIONS.find((option) => option.code === language) ?? LANGUAGE_OPTIONS[0];
}
