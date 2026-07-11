import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatCurrency,
  formatCurrencyAxis,
  formatCurrencyFor,
  getCurrencyInputPlaceholder,
  getCurrencyInputProps,
  getCurrencySymbol,
  getLocale,
  setCurrencyConfig,
  setFormattingLanguage,
} from '../lib/currency';

afterEach(() => {
  setFormattingLanguage('en');
  setCurrencyConfig('en-US', 'USD');
  vi.restoreAllMocks();
});

describe('currency formatting', () => {
  it('uses the configured locale and currency', () => {
    setCurrencyConfig('de-DE', 'EUR');
    setFormattingLanguage('de');

    expect(formatCurrency(1234.56)).toBe(
      new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
      }).format(1234.56)
    );
    expect(formatCurrencyAxis(1234.56)).toBe(
      new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(1234.56)
    );
    expect(getCurrencySymbol()).toBe('€');
    expect(getLocale()).toBe('de-DE');
    expect(getCurrencyInputProps()).toMatchObject({
      suffix: '\u00a0€',
      decimalSeparator: ',',
      thousandSeparator: '.',
      allowedDecimalSeparators: [','],
      decimalScale: 2,
    });
    expect(getCurrencyInputPlaceholder()).toBe('0,00');
  });

  it('uses the selected language while preserving deployment region', () => {
    setCurrencyConfig('en-GB', 'GBP');
    setFormattingLanguage('de');

    expect(getLocale()).toBe('de-GB');
    expect(formatCurrency(1234.56)).toBe(
      new Intl.NumberFormat('de-GB', {
        style: 'currency',
        currency: 'GBP',
      }).format(1234.56)
    );
  });

  it('formats a fixed billing currency without replacing it with the deployment currency', () => {
    setCurrencyConfig('de-DE', 'EUR');
    setFormattingLanguage('de');

    expect(formatCurrencyFor(7.5, 'USD')).toBe(
      new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'USD',
      }).format(7.5)
    );
  });

  it('formats missing values as zero', () => {
    expect(formatCurrency(null)).toBe(formatCurrency(0));
    expect(formatCurrency(undefined)).toBe(formatCurrency(0));
  });

  it('keeps the previous configuration when the locale is invalid', () => {
    setCurrencyConfig('de-DE', 'EUR');
    setFormattingLanguage('de');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setCurrencyConfig('invalid_locale', 'NOT-A-CURRENCY');

    expect(formatCurrency(1234.56)).toBe(
      new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
      }).format(1234.56)
    );
  });
});
