import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureFormatting, getMoneyInputPlaceholder, getMoneyInputProps, parseMoneyInput } from './format';

// Hermes (hermes-v260318099.0.5) does not define Intl.NumberFormat.prototype.formatToParts
// on Apple platforms, so calling it throws "TypeError: undefined is not a function". That
// crashed PaymentHistory, AddBill and BillDetail on iOS at first render (getMoneyInputProps).
const locales = [
  ['en-US', 'USD', 'en'],
  ['de-DE', 'EUR', 'de'],
  ['fr-FR', 'EUR', 'fr'],
  ['de-CH', 'CHF', 'de'],
  ['hi-IN', 'INR', 'en'],
  ['ar-EG', 'USD', 'en'],
] as const;

describe('money input formatting on Hermes iOS (no NumberFormat.formatToParts)', () => {
  const original = Intl.NumberFormat.prototype.formatToParts;
  // The reference separator comes from real ICU formatToParts for the locale that
  // configureFormatting resolves (UI language + deployment region).
  const expected = new Map(locales.map(([locale, currency, language]) => {
    const resolved = configureFormatting(locale, currency, language).locale;
    const decimal = new Intl.NumberFormat(resolved).formatToParts(1.1).find((part) => part.type === 'decimal')?.value;
    return [locale, decimal ?? '.'];
  }));
  beforeEach(() => {
    // @ts-expect-error simulate the Hermes iOS NumberFormat prototype
    delete Intl.NumberFormat.prototype.formatToParts;
  });
  afterEach(() => {
    Intl.NumberFormat.prototype.formatToParts = original;
    configureFormatting('en-US', 'USD', 'en');
  });

  it.each(locales)('renders the %s placeholder and parses input without formatToParts', (locale, currency, language) => {
    configureFormatting(locale, currency, language);
    const separator = expected.get(locale);
    expect(getMoneyInputProps()).toEqual({ keyboardType: 'decimal-pad', placeholder: `0${separator}00` });
    expect(getMoneyInputPlaceholder()).toBe(`0${separator}00`);
    expect(parseMoneyInput(`12${separator}34`)).toBe(12.34);
    expect(parseMoneyInput('12')).toBe(12);
  });
});

it('never calls formatToParts in shipped app code (unsupported by Hermes on iOS)', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && /\.formatToParts\b/.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
  };
  walk(join(__dirname, '..'));
  expect(offenders).toEqual([]);
});
