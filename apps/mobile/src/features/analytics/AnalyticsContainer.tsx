import React, { useMemo, useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import { useMobileRuntime } from '../../context/MobileRuntimeContext';
import { formatDate, getFormattingConfig } from '../../i18n/format';
import { buildAnalyticsModel } from './analyticsMath';
import AnalyticsScreen from './AnalyticsScreen';
import type { AnalyticsRange } from './models';
import { useTranslation } from 'react-i18next';

export default function AnalyticsContainer() {
  const { t } = useTranslation();
  const runtime = useMobileRuntime();
  const { currentDatabase, databases } = useAuth();
  const formatting = getFormattingConfig();
  const currentYear = new Date().getFullYear();
  const [range, setRange] = useState<AnalyticsRange>('12m');
  const [year, setYear] = useState(currentYear);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);

  const analytics = useMemo(() => buildAnalyticsModel({
    bills: runtime.bills,
    payments: runtime.payments,
    range,
    year,
    today: new Date(),
    locale: formatting.locale,
    uncategorizedLabel: t('mobileCore.common.uncategorized'),
    noAccountLabel: t('mobileCore.common.noAccount'),
  }), [formatting.locale, range, runtime.bills, runtime.payments, t, year]);

  const bucketLabel = currentDatabase === '_all_'
    ? t('mobileCore.common.allBuckets')
    : databases.find((database) => database.name === currentDatabase)?.display_name ?? t('mobileParity.analytics.currentBucket');
  const availableYears = useMemo(() => {
    const paymentYears = runtime.payments
      .map((payment) => Number(payment.payment_date.slice(0, 4)))
      .filter(Number.isInteger);
    return [...new Set([
      currentYear,
      currentYear - 1,
      currentYear - 2,
      currentYear - 3,
      currentYear - 4,
      currentYear - 5,
      ...paymentYears,
    ])].sort((left, right) => right - left);
  }, [currentYear, runtime.payments]);

  return (
    <AnalyticsScreen
      model={{
        status: runtime.loading ? 'loading' : runtime.error && runtime.payments.length === 0 ? 'error' : 'ready',
        errorMessage: runtime.error ?? undefined,
        offline: !runtime.online,
        lastUpdatedLabel: runtime.lastSyncedAt ? formatDate(runtime.lastSyncedAt) : undefined,
        locale: formatting.locale,
        currency: formatting.currency,
        bucketLabel,
        range,
        selectedYear: year,
        availableYears,
        yearPickerVisible,
        ...analytics,
        refreshing: runtime.syncing,
      }}
      actions={{
        onChangeRange: setRange,
        onOpenYearPicker: () => setYearPickerVisible(true),
        onSelectYear: (selectedYear) => {
          setYear(selectedYear);
          setYearPickerVisible(false);
        },
        onCloseYearPicker: () => setYearPickerVisible(false),
        onRefresh: () => void runtime.syncNow().catch(() => undefined),
        onRetry: () => void runtime.syncNow().catch(() => undefined),
      }}
    />
  );
}
