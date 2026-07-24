import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { applyLocaleDefault, setLanguage } from '../i18n';
import {
  formatCurrency,
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
  it('updates document metadata and locale formatting without replacing deployment currency', async () => {
    addMetadataElements();
    setCurrencyConfig('en-US', 'CNY');

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
    expect(formatCurrency(1234.56)).toBe(
      new Intl.NumberFormat('de-US', {
        style: 'currency',
        currency: 'CNY',
      }).format(1234.56)
    );
  });

  it('preserves deployment currency when restoring a saved language', () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue('de');
    setCurrencyConfig('en-US', 'JPY');

    applyLocaleDefault('en-US');

    expect(formatCurrency(1234.56)).toBe(
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'JPY',
      }).format(1234.56)
    );
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
