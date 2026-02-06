import { useEffect, useState } from 'react';
import { Stack, Title, Paper, Center, Text, Grid, Group, SimpleGrid, ThemeIcon, Alert, Loader } from '@mantine/core';
import { IconChartPie, IconTrendingUp, IconTrendingDown, IconAlertCircle } from '@tabler/icons-react';
import { AccountPieChart } from '../components/Analytics/AccountPieChart';
import { YoYComparison } from '../components/Analytics/YoYComparison';
import { getStatsByAccount, getStatsYearly, getMonthlyComparison } from '../api/client';
import type { AccountStats, YearlyStats, MonthlyComparison as MonthlyComparisonType } from '../api/client';

interface AnalyticsProps {
  hasDatabase: boolean;
}

export function Analytics({ hasDatabase }: AnalyticsProps) {
  const [accountStats, setAccountStats] = useState<AccountStats[]>([]);
  const [yearlyStats, setYearlyStats] = useState<YearlyStats | null>(null);
  const [monthlyComparison, setMonthlyComparison] = useState<MonthlyComparisonType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasDatabase) {
      loadData();
    }
  }, [hasDatabase]);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [accounts, yearly, comparison] = await Promise.all([
        getStatsByAccount().catch(() => []),
        getStatsYearly().catch(() => ({})),
        getMonthlyComparison().catch(() => null),
      ]);

      setAccountStats(accounts);
      setYearlyStats(yearly);
      setMonthlyComparison(comparison);
    } catch (err) {
      setError('Failed to load analytics data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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
            {yearlyEntries.map(([year, data]) => (
              <Paper key={year} withBorder p="sm" radius="sm" bg="gray.0">
                <Text size="xs" c="dimmed" fw={600}>{year}</Text>
                <Text fw={600} c="red">-${data.expenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                {data.deposits > 0 && (
                  <Text size="sm" c="green">+${data.deposits.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                )}
              </Paper>
            ))}
          </SimpleGrid>
        </Paper>
      )}
    </Stack>
  );
}
