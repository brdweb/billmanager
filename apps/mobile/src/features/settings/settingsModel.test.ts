import { describe, expect, it } from 'vitest';

import {
  buildMobileVersionInfo,
  formatLocaleExample,
  resolveTelemetryStatus,
  resolveUserCurrency,
} from './settingsModel';

describe('settings model', () => {
  it('preserves the authenticated user currency over the server default', () => {
    expect(resolveUserCurrency('EUR', 'USD')).toBe('EUR');
    expect(resolveUserCurrency(undefined, 'USD')).toBe('USD');
    expect(resolveUserCurrency(null, null)).toBeUndefined();
  });

  it('keeps telemetry undecided until the owner makes a choice', () => {
    expect(resolveTelemetryStatus({
      show_notice: true,
      telemetry_enabled: true,
    }, true)).toBe('undecided');
    expect(resolveTelemetryStatus({
      show_notice: false,
      opted_out: true,
    }, true)).toBe('disabled');
    expect(resolveTelemetryStatus({
      show_notice: false,
      opted_out: false,
    }, true)).toBe('enabled');
  });

  it('does not expose a writable telemetry state to non-owners', () => {
    expect(resolveTelemetryStatus({
      show_notice: false,
      opted_out: false,
    }, false)).toBe('managed');
    expect(resolveTelemetryStatus({
      show_notice: false,
      reason: 'not_account_owner',
    }, true)).toBe('managed');
  });

  it('formats the regional preview with deployment currency and locale', () => {
    expect(formatLocaleExample({
      language: 'de',
      locale: 'de-DE',
      currency: 'EUR',
    })).toContain('1.234,56');
    expect(formatLocaleExample({
      language: 'en',
      locale: 'en-US',
      currency: 'USD',
    })).toContain('$1,234.56');
  });

  it('falls back safely for development version metadata', () => {
    expect(buildMobileVersionInfo({})).toEqual({
      appVersion: '1.0.0',
      nativeBuild: 'development',
      runtimeVersion: '1.0.0',
      channel: 'development',
      serverVersion: 'unavailable',
      contractVersion: 'unavailable',
    });
  });
});
