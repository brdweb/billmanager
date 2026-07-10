import { useState, useEffect, useCallback } from 'react';
import '@mantine/charts/styles.css';
import { Paper, Text, Loader, Center } from '@mantine/core';
import { AreaChart } from '@mantine/charts';
import { useTranslation } from 'react-i18next';
import { getBillMonthlyPayments } from '../api/client';
import type { MonthlyBillPayment } from '../api/client';
import { formatCurrency, formatCurrencyAxis, getLocale } from '../lib/currency';

interface PaymentHistoryChartProps {
  billName: string | null;
}

interface ChartData {
  month: string;
  label: string;
  total: number;
}

// Safe date parser that handles invalid month strings
function parseMonthString(monthStr: string): { year: number; month: number } | null {
  if (!monthStr || typeof monthStr !== 'string') return null;
  const parts = monthStr.split('-');
  if (parts.length !== 2) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export function PaymentHistoryChart({ billName }: PaymentHistoryChartProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!billName) return;

    setLoading(true);
    try {
      const response = await getBillMonthlyPayments(billName);
      const monthlyData: MonthlyBillPayment[] = response ?? [];

      // Transform and reverse to show chronological order (oldest first)
      const chartData: ChartData[] = monthlyData
        .map((item) => {
          const parsed = parseMonthString(item.month);
          if (!parsed) return null;
          const date = new Date(parsed.year, parsed.month - 1, 1);
          return {
            month: item.month,
            label: date.toLocaleDateString(getLocale(), { month: 'short', year: '2-digit' }),
            total: item.total ?? 0,
          };
        })
        .filter((item): item is ChartData => item !== null)
        .reverse();

      setData(chartData);
    } catch {
      // Silently fail - chart is non-critical
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [billName]);

  useEffect(() => {
    if (billName) {
      fetchData();
    }
  }, [billName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  }

  if (data.length < 2) {
    return null; // Don't show chart if not enough data
  }

  return (
    <Paper p="sm" withBorder mb="md" style={{ minWidth: 0 }}>
      <Text size="sm" fw={500} mb="xs" c="dimmed">
        {t('paymentHistoryChart.title', { count: data.length })}
      </Text>
      <AreaChart
        h={150}
        w="100%"
        data={data}
        dataKey="label"
        series={[{ name: 'total', color: 'teal.6', label: t('common.table.amount') }]}
        curveType="monotone"
        withTooltip
        tooltipProps={{
          content: ({ payload }) => {
            if (!payload || payload.length === 0) return null;
            const item = payload[0].payload as ChartData;
            return (
              <Paper px="md" py="sm" withBorder shadow="md" radius="md">
                <Text fw={500}>{item.label}</Text>
                <Text c="dimmed" size="sm">
                  {formatCurrency(item.total)}
                </Text>
              </Paper>
            );
          },
        }}
        yAxisProps={{
          tickFormatter: (value: number) => formatCurrencyAxis(value),
        }}
      />
    </Paper>
  );
}
