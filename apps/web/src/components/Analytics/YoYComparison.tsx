import { useMemo } from 'react';
import { Paper, Title, Text, Box, Group, Stack } from '@mantine/core';
import { BarChart } from '@mantine/charts';
import type { MonthlyComparison } from '../../api/client';

interface YoYComparisonProps {
  data: MonthlyComparison | null;
  loading?: boolean;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function YoYComparison({ data, loading }: YoYComparisonProps) {
  const chartData = useMemo(() => {
    if (!data?.months) return [];

    return data.months.map((m) => ({
      month: MONTH_NAMES[parseInt(m.month, 10) - 1],
      [`${data.last_year}`]: m.last_year_expenses,
      [`${data.current_year}`]: m.current_year_expenses,
    }));
  }, [data]);

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
        <Title order={5} mb="md">Year-over-Year Comparison</Title>
        <Box h={300} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text c="dimmed">Loading...</Text>
        </Box>
      </Paper>
    );
  }

  if (!data || chartData.length === 0) {
    return (
      <Paper withBorder p="md" radius="md" h={400}>
        <Title order={5} mb="md">Year-over-Year Comparison</Title>
        <Box h={300} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text c="dimmed">No data available for comparison</Text>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={5}>Year-over-Year Comparison</Title>
        <Stack gap={0} align="flex-end">
          <Text size="xs" c="dimmed">
            {data.current_year} vs {data.last_year}
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
            return (
              <Paper px="md" py="sm" withBorder shadow="md" radius="md">
                <Text size="sm" fw={500} mb="xs">{payload[0].payload.month}</Text>
                {payload.map((item: { name?: string; value?: number; color?: string }) => (
                  <Group key={item.name} gap="xs">
                    <Box style={{ width: 8, height: 8, background: item.color, borderRadius: 2 }} />
                    <Text size="sm">
                      {item.name}: ${(item.value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
          <Text size="xs" c="dimmed">{data.last_year} Total</Text>
          <Text fw={600}>${totals.lastYear.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
        </Stack>
        <Stack gap={0} align="center">
          <Text size="xs" c="dimmed">{data.current_year} Total</Text>
          <Text fw={600}>${totals.currentYear.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
        </Stack>
      </Group>
    </Paper>
  );
}
