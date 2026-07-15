import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { applyLocaleDefault, setLanguage } from '../i18n';
import {
  formatCurrency,
  getCurrencySymbol,
  getLocale,
  setCurrencyConfig,
} from '../lib/currency';

function addMetadataElements() {
  document.head.innerHTML = `
    <meta name="description" content="">
    <meta property="og:description" content="">
    <link rel="manifest" href="/manifest.json">
  `;
}

afterEach(async () => {
  vi.mocked(window.localStorage.getItem).mockReset();
  vi.mocked(window.localStorage.setItem).mockReset();
  setCurrencyConfig('en-US', 'USD');
  await i18n.changeLanguage('en');
  document.head.innerHTML = '';
});

describe('language switching', () => {
  it('updates document metadata, locale formatting, and the saved preference', async () => {
    addMetadataElements();
    setCurrencyConfig('en-US', 'USD');

    setLanguage('de');
    await vi.waitFor(() => expect(i18n.language).toBe('de'));

    expect(window.localStorage.setItem).toHaveBeenCalledWith('billmanager:language', 'de');
    expect(document.documentElement.lang).toBe('de');
    expect(document.querySelector('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.de.json'
    );
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      'Behalten Sie Ihre Rechnungen und Einnahmen mühelos im Blick'
    );
    expect(getLocale()).toBe('de-US');
    expect(getCurrencySymbol()).toBe('€');
    expect(formatCurrency(1234.56)).toBe(
      new Intl.NumberFormat('de-US', {
        style: 'currency',
        currency: 'EUR',
      }).format(1234.56)
    );
  });

  it('reapplies a saved language currency after deployment config loads', () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue('de');
    setCurrencyConfig('en-US', 'USD');

    applyLocaleDefault('en-US');

    expect(getCurrencySymbol()).toBe('€');
  });

  it('uses the server locale when there is no saved browser preference', async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue(null);

    applyLocaleDefault('de-DE');
    await vi.waitFor(() => expect(i18n.language).toBe('de'));
  });

  it('keeps an explicit browser preference over the server locale', async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue('en');

    applyLocaleDefault('de-DE');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(i18n.language).toBe('en');
  });
});
