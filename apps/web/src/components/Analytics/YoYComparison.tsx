import { useMemo } from 'react';
import '@mantine/charts/styles.css';
import { Paper, Title, Text, Box, Group, Stack } from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { useTranslation } from 'react-i18next';
import type { MonthlyComparison } from '../../api/client';
import { formatCurrency } from '../../lib/currency';

interface YoYComparisonProps {
  data: MonthlyComparison | null;
  loading?: boolean;
}

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

export function YoYComparison({ data, loading }: YoYComparisonProps) {
  const { t } = useTranslation();
  const chartData = useMemo(() => {
    if (!data?.months) return [];

    return data.months.map((m) => ({
      month: t(`common.monthsShort.${MONTH_KEYS[parseInt(m.month, 10) - 1]}`),
      [`${data.last_year}`]: m.last_year_expenses,
      [`${data.current_year}`]: m.current_year_expenses,
    }));
  }, [data, t]);

  const totals = useMemo(() => {
    if (!data?.months) return { lastYear: 0, currentYear: 0 };

    return data.months.reduce(
      (acc, m) => ({
        lastYear: acc.lastYear + m.last_year_expenses,
        currentYear: acc.currentYear + m.current_year_expenses,
      }),
      { lastYear: 0, currentYear: 0 }
    );
  }, [data]);

  const percentChange = useMemo(() => {
    if (totals.lastYear === 0) return 0;
    return ((totals.currentYear - totals.lastYear) / totals.lastYear) * 100;
  }, [totals]);

  if (loading) {
    return (
      <Paper withBorder p="md" radius="md" h={400}>
        <Title order={5} mb="md">{t('analytics.yoyComparison.title')}</Title>
        <Box h={300} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text c="dimmed">{t('common.loading')}</Text>
        </Box>
      </Paper>
    );
  }

  if (!data || chartData.length === 0) {
    return (
      <Paper withBorder p="md" radius="md" h={400}>
        <Title order={5} mb="md">{t('analytics.yoyComparison.title')}</Title>
        <Box h={300} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text c="dimmed">{t('analytics.yoyComparison.noData')}</Text>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={5}>{t('analytics.yoyComparison.title')}</Title>
        <Stack gap={0} align="flex-end">
          <Text size="xs" c="dimmed">
            {t('analytics.yoyComparison.vsLabel', { currentYear: data.current_year, lastYear: data.last_year })}
          </Text>
          <Text
            size="sm"
            fw={600}
            c={percentChange >= 0 ? 'red' : 'green'}
          >
            {percentChange >= 0 ? '+' : ''}{percentChange.toFixed(1)}%
          </Text>
        </Stack>
      </Group>

      <BarChart
        h={280}
        data={chartData}
        dataKey="month"
        series={[
          { name: `${data.last_year}`, color: 'gray.5' },
          { name: `${data.current_year}`, color: 'blue.6' },
        ]}
        withLegend
        legendProps={{ verticalAlign: 'bottom', height: 30 }}
        withTooltip
        tooltipProps={{
          content: ({ payload }) => {
            if (!payload || payload.length === 0) return null;
            const firstPayload = payload[0]?.payload as { month?: string } | undefined;
            return (
              <Paper px="md" py="sm" withBorder shadow="md" radius="md">
                <Text size="sm" fw={500} mb="xs">{firstPayload?.month}</Text>
                {payload.map((item) => (
                  <Group key={String(item.name)} gap="xs">
                    <Box style={{ width: 8, height: 8, background: item.color, borderRadius: 2 }} />
                    <Text size="sm">
                      {String(item.name)}: {formatCurrency(Number(item.value ?? 0))}
                    </Text>
                  </Group>
                ))}
              </Paper>
            );
          },
        }}
      />

      <Group justify="space-around" mt="md">
        <Stack gap={0} align="center">
          <Text size="xs" c="dimmed">{t('analytics.yoyComparison.yearTotal', { year: data.last_year })}</Text>
          <Text fw={600}>{formatCurrency(totals.lastYear)}</Text>
        </Stack>
        <Stack gap={0} align="center">
          <Text size="xs" c="dimmed">{t('analytics.yoyComparison.yearTotal', { year: data.current_year })}</Text>
          <Text fw={600}>{formatCurrency(totals.currentYear)}</Text>
        </Stack>
      </Group>
    </Paper>
  );
}
