import { useMemo } from 'react';
import { Paper, Title, Text, Stack, Group, Box, ColorSwatch } from '@mantine/core';
import { PieChart } from '@mantine/charts';
import type { AccountStats } from '../../api/client';

interface AccountPieChartProps {
  data: AccountStats[];
  loading?: boolean;
}

// Generate consistent colors for accounts
const COLORS = [
  'blue',
  'green',
  'red',
  'orange',
  'grape',
  'teal',
  'cyan',
  'pink',
  'indigo',
  'yellow',
];

export function AccountPieChart({ data, loading }: AccountPieChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Only show top 8 accounts, group rest as "Other"
    const sorted = [...data].sort((a, b) => b.expenses - a.expenses);
    const top8 = sorted.slice(0, 8);
    const others = sorted.slice(8);
    const otherTotal = others.reduce((sum, a) => sum + a.expenses, 0);

    const result = top8.map((account, i) => ({
      name: account.account,
      value: account.expenses,
      color: `var(--mantine-color-${COLORS[i % COLORS.length]}-6)`,
    }));

    if (otherTotal > 0) {
      result.push({
        name: 'Other',
        value: otherTotal,
        color: 'var(--mantine-color-gray-6)',
      });
    }

    return result;
  }, [data]);

  const total = useMemo(() => {
    return chartData.reduce((sum, item) => sum + item.value, 0);
  }, [chartData]);

  if (loading) {
    return (
      <Paper withBorder p="md" radius="md" h={350}>
        <Title order={5} mb="md">Spending by Account</Title>
        <Box h={250} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text c="dimmed">Loading...</Text>
        </Box>
      </Paper>
    );
  }

  if (chartData.length === 0) {
    return (
      <Paper withBorder p="md" radius="md" h={350}>
        <Title order={5} mb="md">Spending by Account</Title>
        <Box h={250} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text c="dimmed">No payment data available</Text>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Title order={5} mb="md">Spending by Account</Title>

      <Group align="flex-start" gap="xl">
        <PieChart
          data={chartData}
          withLabels
          labelsType="percent"
          size={200}
          withTooltip
          tooltipDataSource="segment"
        />

        <Stack gap="xs" style={{ flex: 1 }}>
          {chartData.map((item) => (
            <Group key={item.name} justify="space-between" gap="xs">
              <Group gap="xs">
                <ColorSwatch color={item.color} size={12} />
                <Text size="sm" style={{ maxWidth: 120 }} truncate>
                  {item.name}
                </Text>
              </Group>
              <Group gap="xs">
                <Text size="sm" fw={500}>
                  ${item.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </Text>
                <Text size="xs" c="dimmed">
                  ({((item.value / total) * 100).toFixed(1)}%)
                </Text>
              </Group>
            </Group>
          ))}
        </Stack>
      </Group>

      <Text size="xs" c="dimmed" mt="md" ta="center">
        Total: ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </Text>
    </Paper>
  );
}
