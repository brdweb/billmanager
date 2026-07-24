import type { FormattingConfig } from '../../i18n/format';

export interface TelemetryNoticeState {
  show_notice: boolean;
  opted_out?: boolean;
  telemetry_enabled?: boolean;
  reason?: string;
}

export type TelemetryStatus =
  | 'enabled'
  | 'disabled'
  | 'undecided'
  | 'managed'
  | 'unavailable';

export function resolveUserCurrency(
  userCurrency?: string | null,
  serverDefaultCurrency?: string | null,
): string | undefined {
  return userCurrency || serverDefaultCurrency || undefined;
}

export function resolveTelemetryStatus(
  state: TelemetryNoticeState | null,
  isAccountOwner: boolean,
): TelemetryStatus {
  if (!isAccountOwner || state?.reason === 'not_account_owner') return 'managed';
  if (!state) return 'unavailable';
  if (state.telemetry_enabled === false) return 'disabled';
  if (state.show_notice) return 'undecided';
  return state.opted_out ? 'disabled' : 'enabled';
}

export function formatLocaleExample(
  config: FormattingConfig,
  amount = 1234.56,
  date = new Date('2026-07-15T12:00:00Z'),
): string {
  const currency = new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
  }).format(amount);
  const formattedDate = new Intl.DateTimeFormat(config.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return currency + ' • ' + formattedDate;
}

export interface MobileVersionInfo {
  appVersion: string;
  nativeBuild: string;
  runtimeVersion: string;
  channel: string;
  serverVersion: string;
  contractVersion: string;
}

export function buildMobileVersionInfo(input: {
  appVersion?: string | null;
  nativeBuild?: string | null;
  runtimeVersion?: string | null;
  channel?: string | null;
  serverVersion?: string | null;
  contractVersion?: number | null;
}): MobileVersionInfo {
  return {
    appVersion: input.appVersion || '1.0.0',
    nativeBuild: input.nativeBuild || 'development',
    runtimeVersion: input.runtimeVersion || input.appVersion || '1.0.0',
    channel: input.channel || 'development',
    serverVersion: input.serverVersion || 'unavailable',
    contractVersion: input.contractVersion == null
      ? 'unavailable'
      : String(input.contractVersion),
  };
}
