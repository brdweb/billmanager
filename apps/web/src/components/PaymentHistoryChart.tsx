import { useState, useEffect, useCallback } from 'react';
import { Paper, Text, Loader, Center } from '@mantine/core';
import { AreaChart } from '@mantine/charts';
import { getBillMonthlyPayments } from '../api/client';
import type { MonthlyBillPayment } from '../api/client';

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
            label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
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
  }, [billName, fetchData]);

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
    <Paper p="sm" withBorder mb="md">
      <Text size="sm" fw={500} mb="xs" c="dimmed">
        Payment History (Last {data.length} Months)
      </Text>
      <AreaChart
        h={150}
        data={data}
        dataKey="label"
        series={[{ name: 'total', color: 'teal.6', label: 'Amount' }]}
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
                  ${item.total.toFixed(2)}
                </Text>
              </Paper>
            );
          },
        }}
        yAxisProps={{
          tickFormatter: (value: number) => `$${value}`,
        }}
      />
    </Paper>
  );
}
