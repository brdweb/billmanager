import { beforeEach, describe, expect, it } from 'vitest';

import {
  configureFormatting,
  formatCurrency,
  formatDate,
  getCurrencyFractionDigits,
  getFormattingConfig,
  getMoneyInputKeyboardType,
  getMoneyInputPlaceholder,
  getMoneyInputProps,
  parseMoneyInput,
} from './format';

const supportedCurrencies = [
  'USD',
  'EUR',
  'JPY',
  'GBP',
  'CNY',
  'CHF',
  'AUD',
  'CAD',
  'HKD',
  'SGD',
  'INR',
  'KRW',
  'SEK',
  'NZD',
  'MXN',
] as const;

const expectedFractionDigits = [2, 2, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 2, 2, 2] as const;

describe('mobile formatting', () => {
  beforeEach(() => configureFormatting('en-US', 'USD', 'en'));

  it.each(supportedCurrencies)('formats the supported deployment currency %s', (currency) => {
    // Given
    configureFormatting('en-US', currency, 'en');

    // When
    const formatted = formatCurrency(1234.56);

    // Then
    expect(formatted).toBe(new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(1234.56));
  });

  it('exposes zero-decimal input props for JPY/KRW and two-decimal props for the rest', () => {
    // Given / When
    const contracts = supportedCurrencies.map((currency) => {
      configureFormatting('en-US', currency, 'en');
      return {
        currency,
        fractionDigits: getCurrencyFractionDigits(),
        placeholder: getMoneyInputPlaceholder(),
        keyboardType: getMoneyInputKeyboardType(),
        props: getMoneyInputProps(),
      };
    });

    // Then
    expect(contracts).toEqual(supportedCurrencies.map((currency, index) => {
      const fractionDigits = expectedFractionDigits[index];
      const placeholder = fractionDigits === 0 ? '0' : '0.00';
      const keyboardType = fractionDigits === 0 ? 'number-pad' : 'decimal-pad';
      return {
        currency,
        fractionDigits,
        placeholder,
        keyboardType,
        props: { placeholder, keyboardType },
      };
    }));
  });

  it('parses only finite non-negative money at the active currency scale', () => {
    // Given
    configureFormatting('en-US', 'USD', 'en');

    // When / Then
    expect(parseMoneyInput('0')).toBe(0);
    expect(parseMoneyInput('12')).toBe(12);
    expect(parseMoneyInput('12.3')).toBe(12.3);
    expect(parseMoneyInput('12.34')).toBe(12.34);
    expect(parseMoneyInput('12,34')).toBe(12.34);
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('-1')).toBeNull();
    expect(parseMoneyInput('12.345')).toBeNull();
    expect(parseMoneyInput('12 dollars')).toBeNull();
    expect(parseMoneyInput('NaN')).toBeNull();
    expect(parseMoneyInput('Infinity')).toBeNull();
    expect(parseMoneyInput('9'.repeat(400))).toBeNull();
  });

  it.each(['JPY', 'KRW'] as const)('rejects fractional money for %s', (currency) => {
    // Given
    configureFormatting('en-US', currency, 'en');

    // When / Then
    expect(parseMoneyInput('12')).toBe(12);
    expect(parseMoneyInput('12.0')).toBeNull();
    expect(parseMoneyInput('12,0')).toBeNull();
  });

  it('uses the configured locale decimal separator in the placeholder and parser', () => {
    // Given
    configureFormatting('de-DE', 'EUR', 'de');

    // When / Then
    expect(getMoneyInputPlaceholder()).toBe('0,00');
    expect(parseMoneyInput('12,34')).toBe(12.34);
  });

  it('uses deployment currency without a currency whitelist', () => {
    configureFormatting('en-GB', 'GBP', 'en');
    expect(formatCurrency(12.5)).toContain('12.50');
    expect(getFormattingConfig().currency).toBe('GBP');
  });

  it('combines the UI language with the deployment region', () => {
    configureFormatting('en-US', 'USD', 'de');
    expect(getFormattingConfig().locale).toBe('de-US');
  });

  it('falls back safely for invalid configuration', () => {
    configureFormatting('not-a-locale', 'not-a-currency', 'en');
    expect(getFormattingConfig()).toEqual({
      locale: 'en-US',
      currency: 'USD',
      language: 'en',
    });
  });

  it('formats valid dates and leaves invalid dates blank', () => {
    expect(formatDate('2026-07-15')).toBe('Jul 15');
    expect(formatDate('not-a-date')).toBe('');
  });
});
