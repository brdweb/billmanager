/**
 * Shared locale and currency formatting utilities.
 *
 * DEFAULT_LOCALE supplies the deployment's regional conventions while the
 * user's selected UI language supplies the language subtag. For example, an
 * English user on a German deployment formats with `en-DE`, while switching
 * the UI to German formats with `de-DE`.
 */

export interface CurrencyInputFormatProps {
  prefix?: string;
  suffix?: string;
  decimalSeparator: string;
  thousandSeparator?: string;
  allowedDecimalSeparators: string[];
  decimalScale: number;
}

let configuredLocale = 'en-US';
let currentLanguage = 'en';
let currentLocale = resolveLocale(configuredLocale, currentLanguage);
let currentCurrency = 'USD';
let formatter = buildFormatter(currentLocale, currentCurrency);
let axisFormatter = buildFormatter(currentLocale, currentCurrency, {
  maximumFractionDigits: 0,
});
let cachedSymbol = extractSymbol(formatter, currentCurrency);
let cachedInputProps = buildCurrencyInputProps(currentLocale, formatter);

function resolveLocale(locale: string, language: string): string {
  const base = new Intl.Locale(locale);
  const normalizedLanguage = language.split(/[-_]/)[0].toLowerCase();

  return new Intl.Locale(normalizedLanguage, {
    region: base.region,
    script: base.script,
    calendar: base.calendar,
    hourCycle: base.hourCycle,
    numberingSystem: base.numberingSystem,
  }).toString();
}

function buildFormatter(
  locale: string,
  currency: string,
  extra: Intl.NumberFormatOptions = {}
): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    ...extra,
  });
}

function extractSymbol(fmt: Intl.NumberFormat, currency: string): string {
  const part = fmt.formatToParts(0).find((item) => item.type === 'currency');
  return part?.value ?? currency;
}

function buildCurrencyInputProps(
  locale: string,
  currencyFormatter: Intl.NumberFormat
): CurrencyInputFormatProps {
  const currencyParts = currencyFormatter.formatToParts(1234.5);
  const numberParts = new Intl.NumberFormat(locale).formatToParts(1234.5);
  const currencyIndex = currencyParts.findIndex((part) => part.type === 'currency');
  const firstIntegerIndex = currencyParts.findIndex((part) => part.type === 'integer');
  const lastNumberIndex = currencyParts.reduce(
    (last, part, index) =>
      ['integer', 'group', 'decimal', 'fraction'].includes(part.type) ? index : last,
    -1
  );
  const currencyBeforeNumber = currencyIndex >= 0 && currencyIndex < firstIntegerIndex;
  const affix = currencyBeforeNumber
    ? currencyParts.slice(currencyIndex, firstIntegerIndex).map((part) => part.value).join('')
    : currencyParts.slice(lastNumberIndex + 1, currencyIndex + 1).map((part) => part.value).join('');
  const decimalSeparator = numberParts.find((part) => part.type === 'decimal')?.value ?? '.';
  const thousandSeparator = numberParts.find((part) => part.type === 'group')?.value;
  const alternateDecimalSeparator = decimalSeparator === '.' ? ',' : '.';
  const allowedDecimalSeparators = [decimalSeparator, alternateDecimalSeparator].filter(
    (separator) => separator !== thousandSeparator
  );

  return {
    ...(currencyBeforeNumber ? { prefix: affix } : { suffix: affix }),
    decimalSeparator,
    ...(thousandSeparator && thousandSeparator !== decimalSeparator
      ? { thousandSeparator }
      : {}),
    allowedDecimalSeparators,
    decimalScale: currencyFormatter.resolvedOptions().maximumFractionDigits ?? 2,
  };
}

function applyFormattingConfig(locale: string, currency: string, language: string): void {
  const resolvedLocale = resolveLocale(locale, language);
  const nextFormatter = buildFormatter(resolvedLocale, currency);
  const nextAxisFormatter = buildFormatter(resolvedLocale, currency, {
    maximumFractionDigits: 0,
  });
  const nextSymbol = extractSymbol(nextFormatter, currency);
  const nextInputProps = buildCurrencyInputProps(resolvedLocale, nextFormatter);

  currentLocale = resolvedLocale;
  formatter = nextFormatter;
  axisFormatter = nextAxisFormatter;
  cachedSymbol = nextSymbol;
  cachedInputProps = nextInputProps;
}

export function setCurrencyConfig(locale: string, currency: string): void {
  if (locale === configuredLocale && currency === currentCurrency) return;

  try {
    applyFormattingConfig(locale, currency, currentLanguage);
    configuredLocale = locale;
    currentCurrency = currency;
  } catch {
    console.warn(
      `Invalid locale/currency "${locale}"/"${currency}", keeping "${configuredLocale}"/"${currentCurrency}"`
    );
  }
}

export function setFormattingLanguage(language: string): void {
  const normalizedLanguage = language.split(/[-_]/)[0].toLowerCase();
  if (normalizedLanguage === currentLanguage) return;

  try {
    applyFormattingConfig(configuredLocale, currentCurrency, normalizedLanguage);
    currentLanguage = normalizedLanguage;
  } catch {
    console.warn(
      `Invalid formatting language "${language}", keeping "${currentLanguage}"`
    );
  }
}

export function getLocale(): string {
  return currentLocale;
}

export function formatCurrency(value: number | null | undefined): string {
  return formatter.format(value ?? 0);
}

export function formatCurrencyAxis(value: number | null | undefined): string {
  return axisFormatter.format(value ?? 0);
}

export function formatCurrencyFor(
  value: number | null | undefined,
  currency: string
): string {
  return buildFormatter(currentLocale, currency).format(value ?? 0);
}

export function getCurrencySymbol(): string {
  return cachedSymbol;
}

export function getCurrencyInputProps(): CurrencyInputFormatProps {
  return {
    ...cachedInputProps,
    allowedDecimalSeparators: [...cachedInputProps.allowedDecimalSeparators],
  };
}

export function getCurrencyInputPlaceholder(): string {
  const { decimalSeparator, decimalScale } = cachedInputProps;
  return decimalScale > 0
    ? `0${decimalSeparator}${'0'.repeat(decimalScale)}`
    : '0';
}
