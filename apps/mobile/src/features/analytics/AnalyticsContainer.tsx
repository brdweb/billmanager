import React, { useMemo, useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import { useMobileRuntime } from '../../context/MobileRuntimeContext';
import { formatDate, getFormattingConfig } from '../../i18n/format';
import { nextOccurrence } from '../../native/reminderSchedule';
import type { Bill } from '../../types';
import AnalyticsScreen from './AnalyticsScreen';
import type {
  AnalyticsBreakdownItem,
  AnalyticsCashFlowPoint,
  AnalyticsMonthlyPoint,
  AnalyticsRange,
  AnalyticsYearPoint,
} from './models';
import { useTranslation } from 'react-i18next';

function shareBreakdown(values: Map<string, number>): AnalyticsBreakdownItem[] {
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  return [...values.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, amount], index) => ({
      id: label,
      label,
      amount,
      sharePercent: total > 0 ? (amount / total) * 100 : 0,
      color: ['#006C4C', '#F36C00', '#587A6D', '#8A6F45', '#496A8B'][index % 5],
    }));
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function projectRecurringBills(bills: Bill[], start: Date, end: Date) {
  const projected = new Map<string, { income: number; expenses: number }>();
  bills.filter((bill) => !bill.archived).forEach((bill) => {
    let occurrence = new Date(`${bill.next_due}T09:00:00`);
    if (Number.isNaN(occurrence.getTime())) return;
    let guard = 0;
    while (occurrence <= end && guard < 2048) {
      if (occurrence >= start) {
        const key = monthKey(occurrence);
        const point = projected.get(key) ?? { income: 0, expenses: 0 };
        const amount = bill.amount ?? bill.avg_amount ?? 0;
        if (bill.type === 'deposit') point.income += amount;
        else point.expenses += amount;
        projected.set(key, point);
      }
      const next = nextOccurrence(bill, occurrence);
      if (!next || next <= occurrence) break;
      occurrence = next;
      guard += 1;
    }
  });
  return projected;
}

export default function AnalyticsContainer() {
  const { t } = useTranslation();
  const runtime = useMobileRuntime();
  const { currentDatabase, databases } = useAuth();
  const formatting = getFormattingConfig();
  const currentYear = new Date().getFullYear();
  const [range, setRange] = useState<AnalyticsRange>('12m');
  const [year, setYear] = useState(currentYear);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  const billMap = useMemo(() => new Map(runtime.bills.map((bill) => [bill.id, bill])), [runtime.bills]);

  const analytics = useMemo(() => {
    const byMonth = new Map<string, { income: number; expenses: number }>();
    const byYear = new Map<number, { income: number; expenses: number }>();
    const categories = new Map<string, number>();
    const accounts = new Map<string, number>();
    const monthCount = range === '6m' ? 6 : 12;
    const rangeStart = new Date(year, 12 - monthCount, 1);
    const rangeEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    runtime.payments.forEach((payment) => {
      const bill = billMap.get(payment.bill_id);
      const date = new Date(`${payment.payment_date}T00:00:00`);
      if (Number.isNaN(date.getTime())) return;
      const paymentYear = date.getFullYear();
      const monthKey = `${paymentYear}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const direction = payment.bill_type ?? payment.original_bill_type ?? bill?.type;
      const deposit = direction === 'deposit' || payment.is_received_payment;
      const month = byMonth.get(monthKey) ?? { income: 0, expenses: 0 };
      const annual = byYear.get(paymentYear) ?? { income: 0, expenses: 0 };
      if (deposit) {
        month.income += payment.amount;
        annual.income += payment.amount;
      } else {
        month.expenses += payment.amount;
        annual.expenses += payment.amount;
        if (date >= rangeStart && date <= rangeEnd) {
          const category = bill?.category ?? t('mobileCore.common.uncategorized');
          const account = bill?.account ?? t('mobileCore.common.noAccount');
          categories.set(category, (categories.get(category) ?? 0) + payment.amount);
          accounts.set(account, (accounts.get(account) ?? 0) + payment.amount);
        }
      }
      byMonth.set(monthKey, month);
      byYear.set(paymentYear, annual);
    });

    const monthly: AnalyticsMonthlyPoint[] = Array.from({ length: monthCount }, (_, index) => {
      const date = new Date(year, 11 - (monthCount - 1 - index), 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const point = byMonth.get(key) ?? { income: 0, expenses: 0 };
      return {
        key,
        label: new Intl.DateTimeFormat(formatting.locale, { month: 'short' }).format(date),
        income: point.income,
        expenses: point.expenses,
        net: point.income - point.expenses,
      };
    });
    const yearly: AnalyticsYearPoint[] = [year - 2, year - 1, year].map((value) => {
      const point = byYear.get(value) ?? { income: 0, expenses: 0 };
      return { year: value, income: point.income, expenses: point.expenses, net: point.income - point.expenses };
    });
    const today = new Date();
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const projectionStart = rangeStart > currentMonth ? rangeStart : currentMonth;
    const projected = projectRecurringBills(runtime.bills, projectionStart, rangeEnd);
    let balance = 0;
    const cashFlow: AnalyticsCashFlowPoint[] = monthly.map((point) => {
      const pointDate = new Date(`${point.key}-01T00:00:00`);
      const forecast = pointDate >= currentMonth;
      const values = forecast ? projected.get(point.key) ?? { income: 0, expenses: 0 } : point;
      const openingBalance = balance;
      balance += values.income - values.expenses;
      return {
        key: point.key,
        label: point.label,
        openingBalance,
        income: values.income,
        expenses: values.expenses,
        endingBalance: balance,
        forecast,
      };
    });
    const selected = byYear.get(year) ?? { income: 0, expenses: 0 };
    const previous = byYear.get(year - 1) ?? { income: 0, expenses: 0 };
    const net = selected.income - selected.expenses;
    return {
      annual: {
        year,
        income: selected.income,
        expenses: selected.expenses,
        net,
        savingsRate: selected.income > 0 ? (net / selected.income) * 100 : 0,
      },
      yearOverYear: {
        currentYear: year,
        previousYear: year - 1,
        incomeChangePercent: previous.income > 0 ? ((selected.income - previous.income) / previous.income) * 100 : 0,
        expenseChangePercent: previous.expenses > 0 ? ((selected.expenses - previous.expenses) / previous.expenses) * 100 : 0,
        netChange: net - (previous.income - previous.expenses),
      },
      categories: shareBreakdown(categories),
      accounts: shareBreakdown(accounts),
      monthly,
      yearly,
      cashFlow,
    };
  }, [billMap, formatting.locale, range, runtime.bills, runtime.payments, t, year]);

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
