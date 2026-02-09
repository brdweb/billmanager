import { useEffect, useState, useMemo } from 'react';
import { Stack, Title, Paper, Center, Text, Grid, Group, SimpleGrid, ThemeIcon, Alert, Loader, SegmentedControl, Divider } from '@mantine/core';
import { BarChart, LineChart } from '@mantine/charts';
import { IconChartPie, IconTrendingUp, IconTrendingDown, IconAlertCircle } from '@tabler/icons-react';
import { AccountPieChart } from '../components/Analytics/AccountPieChart';
import { YoYComparison } from '../components/Analytics/YoYComparison';
import { getStatsByAccount, getStatsYearly, getMonthlyComparison, getMonthlyPayments } from '../api/client';
import type { AccountStats, YearlyStats, MonthlyComparison as MonthlyComparisonType } from '../api/client';

interface AnalyticsProps {
  hasDatabase: boolean;
}

interface ChartData {
  month: string;
  label: string;
  total: number;
}

export function Analytics({ hasDatabase }: AnalyticsProps) {
  const [accountStats, setAccountStats] = useState<AccountStats[]>([]);
  const [yearlyStats, setYearlyStats] = useState<YearlyStats | null>(null);
  const [monthlyComparison, setMonthlyComparison] = useState<MonthlyComparisonType | null>(null);
  const [monthlyPayments, setMonthlyPayments] = useState<Record<string, { deposits: number; expenses: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<string>('bar');
  const [monthRange, setMonthRange] = useState<string>('12');

  useEffect(() => {
    if (hasDatabase) {
      loadData();
    }
  }, [hasDatabase]);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [accounts, yearly, comparison, payments] = await Promise.all([
        getStatsByAccount().catch(() => []),
        getStatsYearly().catch(() => ({})),
        getMonthlyComparison().catch(() => null),
        getMonthlyPayments().catch(() => ({})),
      ]);

      setAccountStats(accounts);
      setYearlyStats(yearly);
      setMonthlyComparison(comparison);
      setMonthlyPayments(payments ?? {});
    } catch (err) {
      setError('Failed to load analytics data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Build spending trends chart data
  const trendData = useMemo((): ChartData[] => {
    const months: ChartData[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const key = `${year}-${month}`;
      const label = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

      const monthData = monthlyPayments[key];
      const total = monthData ? monthData.expenses : 0;

      months.push({ month: key, label, total });
    }

    return months;
  }, [monthlyPayments]);

  const displayData = monthRange === '6' ? trendData.slice(-6) : trendData;
  const totalSpent = displayData.reduce((sum, d) => sum + d.total, 0);
  const monthsWithData = displayData.filter(d => d.total > 0);
  const avgMonthly = monthsWithData.length > 0 ? totalSpent / monthsWithData.length : 0;
  const maxMonth = displayData.reduce((max, d) => d.total > max.total ? d : max, { total: 0, label: 'N/A' } as ChartData);
  const minMonth = monthsWithData.length > 0
    ? monthsWithData.reduce((min, d) => d.total < min.total ? d : min, { total: Infinity, label: 'N/A' } as ChartData)
    : { total: 0, label: 'N/A' } as ChartData;

  if (!hasDatabase) {
    return (
      <Center py="xl">
        <Paper withBorder p="xl" radius="md" ta="center" maw={400}>
          <IconChartPie size={48} color="var(--mantine-color-dimmed)" />
          <Title order={3} mt="md">
            No Bill Group Selected
          </Title>
          <Text c="dimmed" mt="sm">
            Select a bill group from the header to view analytics.
          </Text>
        </Paper>
      </Center>
    );
  }

  if (loading) {
    return (
      <Center py="xl">
        <Loader size="lg" />
      </Center>
    );
  }

  // Calculate yearly summary
  const yearlyEntries = yearlyStats ? Object.entries(yearlyStats).sort((a, b) => b[0].localeCompare(a[0])) : [];
  const currentYearData = yearlyEntries[0];
  const lastYearData = yearlyEntries[1];

  const currentYearTotal = currentYearData ? currentYearData[1].expenses : 0;
  const lastYearTotal = lastYearData ? lastYearData[1].expenses : 0;
  const yoyChange = lastYearTotal > 0 ? ((currentYearTotal - lastYearTotal) / lastYearTotal) * 100 : 0;

  return (
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between" align="center">
        <Title order={2}>Analytics</Title>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red">
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {currentYearData && (
          <Paper withBorder p="md" radius="md">
            <Group justify="space-between">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  {currentYearData[0]} Expenses
                </Text>
                <Text fw={700} size="xl">
                  ${currentYearData[1].expenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </Text>
              </div>
              <ThemeIcon color="blue" variant="light" size="lg" radius="md">
                <IconChartPie size={20} />
              </ThemeIcon>
            </Group>
          </Paper>
        )}

        {lastYearData && (
          <Paper withBorder p="md" radius="md">
            <Group justify="space-between">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  {lastYearData[0]} Expenses
                </Text>
                <Text fw={700} size="xl">
                  ${lastYearData[1].expenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </Text>
              </div>
              <ThemeIcon color="gray" variant="light" size="lg" radius="md">
                <IconChartPie size={20} />
              </ThemeIcon>
            </Group>
          </Paper>
        )}

        {lastYearTotal > 0 && (
          <Paper withBorder p="md" radius="md">
            <Group justify="space-between">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Year-over-Year Change
                </Text>
                <Text fw={700} size="xl" c={yoyChange >= 0 ? 'red' : 'green'}>
                  {yoyChange >= 0 ? '+' : ''}{yoyChange.toFixed(1)}%
                </Text>
              </div>
              <ThemeIcon color={yoyChange >= 0 ? 'red' : 'green'} variant="light" size="lg" radius="md">
                {yoyChange >= 0 ? <IconTrendingUp size={20} /> : <IconTrendingDown size={20} />}
              </ThemeIcon>
            </Group>
          </Paper>
        )}
      </SimpleGrid>

      {/* Spending Trends */}
      {totalSpent > 0 && (
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb="md">
            <Title order={5}>Spending Trends</Title>
            <Group gap="sm">
              <SegmentedControl
                size="xs"
                value={monthRange}
                onChange={setMonthRange}
                data={[
                  { value: '6', label: '6 Months' },
                  { value: '12', label: '12 Months' },
                ]}
              />
              <SegmentedControl
                size="xs"
                value={chartType}
                onChange={setChartType}
                data={[
                  { value: 'bar', label: 'Bar' },
                  { value: 'line', label: 'Line' },
                ]}
              />
            </Group>
          </Group>

          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" mb="md">
            <Paper p="sm" withBorder>
              <Text size="xs" c="dimmed">Total Spent</Text>
              <Text size="lg" fw={700} c="violet">${totalSpent.toFixed(2)}</Text>
            </Paper>
            <Paper p="sm" withBorder>
              <Text size="xs" c="dimmed">Monthly Avg</Text>
              <Text size="lg" fw={700} c="blue">${avgMonthly.toFixed(2)}</Text>
            </Paper>
            <Paper p="sm" withBorder>
              <Text size="xs" c="dimmed">Highest</Text>
              <Text size="lg" fw={700} c="red">${maxMonth.total.toFixed(2)}</Text>
              <Text size="xs" c="dimmed">{maxMonth.label}</Text>
            </Paper>
            <Paper p="sm" withBorder>
              <Text size="xs" c="dimmed">Lowest</Text>
              <Text size="lg" fw={700} c="green">${minMonth.total === Infinity ? '0.00' : minMonth.total.toFixed(2)}</Text>
              <Text size="xs" c="dimmed">{minMonth.total === Infinity ? 'N/A' : minMonth.label}</Text>
            </Paper>
          </SimpleGrid>

          {chartType === 'bar' ? (
            <BarChart
              h={300}
              data={displayData}
              dataKey="label"
              series={[{ name: 'total', color: 'violet.6', label: 'Total Paid' }]}
              withTooltip
              tooltipProps={{
                content: ({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  const item = payload[0].payload as ChartData;
                  return (
                    <Paper px="md" py="sm" withBorder shadow="md" radius="md">
                      <Text fw={500}>{item.label}</Text>
                      <Text c="dimmed" size="sm">${item.total.toFixed(2)}</Text>
                    </Paper>
                  );
                },
              }}
              yAxisProps={{
                tickFormatter: (value: number) => `$${value}`,
              }}
            />
          ) : (
            <LineChart
              h={300}
              data={displayData}
              dataKey="label"
              series={[{ name: 'total', color: 'violet.6', label: 'Total Paid' }]}
              curveType="monotone"
              connectNulls
              withTooltip
              tooltipProps={{
                content: ({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  const item = payload[0].payload as ChartData;
                  return (
                    <Paper px="md" py="sm" withBorder shadow="md" radius="md">
                      <Text fw={500}>{item.label}</Text>
                      <Text c="dimmed" size="sm">${item.total.toFixed(2)}</Text>
                    </Paper>
                  );
                },
              }}
              yAxisProps={{
                tickFormatter: (value: number) => `$${value}`,
              }}
            />
          )}
        </Paper>
      )}

      {/* Charts */}
      <Grid>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <AccountPieChart data={accountStats} loading={loading} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <YoYComparison data={monthlyComparison} loading={loading} />
        </Grid.Col>
      </Grid>

      {/* Yearly Breakdown */}
      {yearlyEntries.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Title order={5} mb="md">Yearly Summary</Title>
          <SimpleGrid cols={{ base: 2, sm: 4, md: 6 }}>
            {yearlyEntries.map(([year, data]) => {
              const net = data.deposits - data.expenses;
              return (
                <Paper key={year} withBorder p="sm" radius="sm" bg="var(--mantine-color-default)">
                  <Text size="sm" fw={700} mb={4}>{year}</Text>
                  <Divider mb={4} />
                  <Group justify="space-between" gap={4}>
                    <Text size="xs" c="dimmed">Expenses</Text>
                    <Text size="sm" fw={600} c="red">-${data.expenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                  </Group>
                  {data.deposits > 0 && (
                    <Group justify="space-between" gap={4}>
                      <Text size="xs" c="dimmed">Deposits</Text>
                      <Text size="sm" fw={600} c="green">+${data.deposits.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                    </Group>
                  )}
                  <Divider my={4} />
                  <Group justify="space-between" gap={4}>
                    <Text size="xs" fw={600}>Net</Text>
                    <Text size="sm" fw={700} c={net >= 0 ? 'green' : 'red'}>
                      {net >= 0 ? '+' : '-'}${Math.abs(net).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Text>
                  </Group>
                </Paper>
              );
            })}
          </SimpleGrid>
        </Paper>
      )}
    </Stack>
  );
}
