import { normalizeLanguage, type SupportedLanguage } from './language';

export interface FormattingConfig {
  locale: string;
  currency: string;
  language: SupportedLanguage;
}

export type MoneyInputKeyboardType = 'decimal-pad' | 'number-pad';

export interface MoneyInputProps {
  readonly keyboardType: MoneyInputKeyboardType;
  readonly placeholder: string;
}

const FALLBACK_CONFIG: FormattingConfig = {
  locale: 'en-US',
  currency: 'USD',
  language: 'en',
};

let formattingConfig = FALLBACK_CONFIG;

function currencyFormatter(): Intl.NumberFormat {
  return new Intl.NumberFormat(formattingConfig.locale, {
    style: 'currency',
    currency: formattingConfig.currency,
  });
}

const decimalSeparators = new Map<string, string>();

// Hermes on iOS implements Intl.NumberFormat format() but not formatToParts(), so the
// separator is read from format(1.1) with the locale's own "1" removed. That keeps
// non-ASCII numbering systems (e.g. Arabic "١٫١") correct and falls back to ".".
function decimalSeparator(): string {
  const { locale } = formattingConfig;
  const cached = decimalSeparators.get(locale);
  if (cached) return cached;

  let separator = '.';
  try {
    const one = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(1);
    const oneAndTenth = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(1.1);
    const candidate = oneAndTenth.split(one).join('').replace(/[\s\u200e\u200f\u061c]/g, '');
    if (candidate.length === 1) separator = candidate;
  } catch {
    // Keep the "." fallback.
  }

  decimalSeparators.set(locale, separator);
  return separator;
}

// Hermes (React Native) has no Intl.Locale on any platform, so the UI language and the
// deployment region are combined from the BCP 47 subtags by hand. Unicode extensions
// (-u-ca-, -u-hc-, -u-nu-) are kept, and the result is canonicalised by
// Intl.getCanonicalLocales, which Hermes does implement.
function resolveLocale(locale: string, language: SupportedLanguage): string {
  const subtags = locale.replace(/_/g, '-').split('-');
  let index = 1;
  let script: string | undefined;
  let region: string | undefined;
  if (/^[A-Za-z]{4}$/.test(subtags[index] ?? '')) script = subtags[index++];
  if (/^(?:[A-Za-z]{2}|\d{3})$/.test(subtags[index] ?? '')) region = subtags[index];
  const extension = /-u(?:-[A-Za-z0-9]{2,8})+/i.exec(locale)?.[0] ?? '';
  try {
    return Intl.getCanonicalLocales(`${[language, script, region].filter(Boolean).join('-')}${extension}`)[0] ?? language;
  } catch {
    return language;
  }
}

export function configureFormatting(
  locale = FALLBACK_CONFIG.locale,
  currency = FALLBACK_CONFIG.currency,
  language: string = FALLBACK_CONFIG.language,
): FormattingConfig {
  const normalizedLanguage = normalizeLanguage(language);
  const resolvedLocale = resolveLocale(locale, normalizedLanguage);

  try {
    // Constructing the formatter validates both values before they become global state.
    new Intl.NumberFormat(resolvedLocale, { style: 'currency', currency }).format(0);
    formattingConfig = {
      locale: resolvedLocale,
      currency: currency.toUpperCase(),
      language: normalizedLanguage,
    };
  } catch {
    formattingConfig = FALLBACK_CONFIG;
  }

  return formattingConfig;
}

// Hermes has no Intl.DisplayNames on any platform; fall back to the ISO code.
export function currencyDisplayName(currency: string, language: string): string {
  const { DisplayNames } = Intl as { DisplayNames?: typeof Intl.DisplayNames };
  if (typeof DisplayNames !== 'function') return currency;
  try {
    return new DisplayNames([language], { type: 'currency' }).of(currency) ?? currency;
  } catch {
    return currency;
  }
}

export function getFormattingConfig(): FormattingConfig {
  return { ...formattingConfig };
}

export function formatCurrency(value: number | null | undefined): string {
  return currencyFormatter().format(value ?? 0);
}

export function getCurrencyFractionDigits(): number {
  const options = currencyFormatter().resolvedOptions();
  return options.maximumFractionDigits ?? options.minimumFractionDigits ?? 0;
}

export function getMoneyInputPlaceholder(): string {
  const fractionDigits = getCurrencyFractionDigits();
  return fractionDigits === 0
    ? '0'
    : `0${decimalSeparator()}${'0'.repeat(fractionDigits)}`;
}

export function getMoneyInputKeyboardType(): MoneyInputKeyboardType {
  return getCurrencyFractionDigits() === 0 ? 'number-pad' : 'decimal-pad';
}

export function getMoneyInputProps(): MoneyInputProps {
  return {
    keyboardType: getMoneyInputKeyboardType(),
    placeholder: getMoneyInputPlaceholder(),
  };
}

export function parseMoneyInput(value: string): number | null {
  const text = value.trim();
  if (!text) return null;

  const fractionDigits = getCurrencyFractionDigits();
  if (fractionDigits === 0) {
    if (!/^\d+$/.test(text)) return null;
  } else {
    const separators = [...new Set([decimalSeparator(), '.', ','])];
    const usedSeparators = separators.filter((separator) => text.includes(separator));
    if (usedSeparators.length > 1) return null;

    const separator = usedSeparators[0];
    if (separator) {
      const parts = text.split(separator);
      const integer = parts[0];
      const fraction = parts[1];
      if (
        parts.length !== 2
        || !integer
        || !fraction
        || !/^\d+$/.test(integer)
        || !/^\d+$/.test(fraction)
        || fraction.length > fractionDigits
      ) return null;
    } else if (!/^\d+$/.test(text)) {
      return null;
    }
  }

  const normalized = [...new Set([decimalSeparator(), ','])]
    .reduce((current, separator) => current.replace(separator, '.'), text);
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function formatCurrencyCompact(value: number | null | undefined): string {
  return new Intl.NumberFormat(formattingConfig.locale, {
    style: 'currency',
    currency: formattingConfig.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string {
  const localDateMatch = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    : null;
  const date = value instanceof Date
    ? value
    : localDateMatch
      ? new Date(
          Number(localDateMatch[1]),
          Number(localDateMatch[2]) - 1,
          Number(localDateMatch[3]),
        )
      : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(formattingConfig.locale, options).format(date);
}
