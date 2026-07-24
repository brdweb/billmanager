import { normalizeSupportedLanguage } from './registry';

type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DateLocaleLoader = () => Promise<unknown>;

export type DateLocaleSettings = {
  readonly locale: string;
  readonly firstDayOfWeek: DayOfWeek;
};

const dayjsLocaleModules = import.meta.glob<unknown>(
  [
    '/node_modules/dayjs/locale/[a-z][a-z].js',
    '/node_modules/dayjs/locale/[a-z][a-z][a-z].js',
  ],
  { exhaustive: true }
);
const indexedDayjsLocaleLoaders: Record<string, DateLocaleLoader> = {};

for (const [modulePath, loader] of Object.entries(dayjsLocaleModules)) {
  const language = modulePath.match(/\/([a-z]{2,3})\.js$/)?.[1];
  if (language) {
    indexedDayjsLocaleLoaders[language] = loader;
  }
}

export const DAYJS_LOCALE_LOADERS: Readonly<Record<string, DateLocaleLoader>> =
  indexedDayjsLocaleLoaders;

function defaultFirstDayOfWeek(language: string): DayOfWeek {
  return language === 'de' ? 1 : 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDayOfWeek(value: unknown): value is DayOfWeek {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0 && value <= 6;
}

export function resolveDateLocale(
  language: string,
  supportedLanguages: readonly string[],
  localeLoaders: Readonly<Record<string, DateLocaleLoader>>
): DateLocaleSettings {
  const normalizedLanguage = normalizeSupportedLanguage(language, supportedLanguages);
  const locale = localeLoaders[normalizedLanguage] ? normalizedLanguage : 'en';

  return {
    locale,
    firstDayOfWeek: defaultFirstDayOfWeek(locale),
  };
}

export async function loadDateLocale(
  locale: DateLocaleSettings,
  localeLoaders: Readonly<Record<string, DateLocaleLoader>>
): Promise<DateLocaleSettings> {
  const loader = localeLoaders[locale.locale];
  if (!loader) {
    return locale;
  }

  const localeModule = await loader();
  const localeMetadata = isRecord(localeModule) ? localeModule['default'] : undefined;
  const weekStart = isRecord(localeMetadata) ? localeMetadata['weekStart'] : undefined;

  return {
    locale: locale.locale,
    firstDayOfWeek: isDayOfWeek(weekStart)
      ? weekStart
      : defaultFirstDayOfWeek(locale.locale),
  };
}
