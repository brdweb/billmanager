export type LanguageOption = {
  readonly value: string;
  readonly label: string;
};

export type TranslationCatalog = Readonly<Record<string, unknown>>;

type LocaleRegistry = {
  readonly supportedLanguages: readonly string[];
  readonly languageOptions: readonly LanguageOption[];
  readonly resources: Readonly<
    Record<string, { readonly translation: TranslationCatalog }>
  >;
  readonly catalogs: Readonly<Record<string, TranslationCatalog>>;
};

type ParsedLocale = {
  readonly code: string;
  readonly languageName: string;
  readonly translation: TranslationCatalog;
};

export class LocaleRegistryError extends Error {
  readonly modulePath: string;

  constructor(modulePath: string, reason: string) {
    super(`Invalid locale module "${modulePath}": ${reason}`);
    this.name = 'LocaleRegistryError';
    this.modulePath = modulePath;
  }
}

export function normalizeSupportedLanguage(
  language: string,
  supportedLanguages: readonly string[]
): string {
  const normalized = language.split(/[-_]/, 1)[0]?.toLowerCase() ?? '';
  return supportedLanguages.includes(normalized) ? normalized : 'en';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLocale(modulePath: string, localeModule: unknown): ParsedLocale {
  const filename = modulePath.slice(modulePath.lastIndexOf('/') + 1);
  if (!/^[a-z]{2,3}\.json$/.test(filename)) {
    throw new LocaleRegistryError(
      modulePath,
      'filename must be a lowercase 2-3 letter language code'
    );
  }

  if (!isRecord(localeModule)) {
    throw new LocaleRegistryError(modulePath, 'catalog must be a JSON object');
  }

  const metadata = localeModule['_meta'];
  const languageName = isRecord(metadata) ? metadata['languageName'] : undefined;
  if (typeof languageName !== 'string' || languageName.trim().length === 0) {
    throw new LocaleRegistryError(modulePath, 'catalog must define non-empty _meta.languageName');
  }

  const translation: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(localeModule)) {
    if (key !== '_meta') {
      translation[key] = value;
    }
  }

  return {
    code: filename.slice(0, -'.json'.length),
    languageName: languageName.trim(),
    translation,
  };
}

export function buildLocaleRegistry(
  localeModules: Readonly<Record<string, unknown>>
): LocaleRegistry {
  const locales = Object.entries(localeModules).map(([modulePath, localeModule]) =>
    parseLocale(modulePath, localeModule)
  );
  if (!locales.some((locale) => locale.code === 'en')) {
    throw new LocaleRegistryError(
      './locales/en.json',
      'English fallback catalog en.json is required'
    );
  }
  const sortedLocales = [...locales].sort((left, right) => {
    if (left.code === 'en') return -1;
    if (right.code === 'en') return 1;
    return left.code.localeCompare(right.code, 'en');
  });
  const resources: Record<string, { readonly translation: TranslationCatalog }> = {};
  const catalogs: Record<string, TranslationCatalog> = {};

  for (const locale of sortedLocales) {
    if (catalogs[locale.code]) {
      throw new LocaleRegistryError(locale.code, 'language code must be unique');
    }
    resources[locale.code] = { translation: locale.translation };
    catalogs[locale.code] = locale.translation;
  }

  return {
    supportedLanguages: sortedLocales.map((locale) => locale.code),
    languageOptions: sortedLocales.map((locale) => ({
      value: locale.code,
      label: locale.languageName,
    })),
    resources,
    catalogs,
  };
}
