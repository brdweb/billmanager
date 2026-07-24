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

function decimalSeparator(): string {
  return new Intl.NumberFormat(formattingConfig.locale)
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal')?.value ?? '.';
}

function resolveLocale(locale: string, language: SupportedLanguage): string {
  try {
    const base = new Intl.Locale(locale);
    return new Intl.Locale(language, {
      region: base.region,
      script: base.script,
      calendar: base.calendar,
      hourCycle: base.hourCycle,
      numberingSystem: base.numberingSystem,
    }).toString();
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
