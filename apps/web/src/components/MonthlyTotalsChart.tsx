import { useState, useEffect } from 'react';
import '@mantine/charts/styles.css';
import { Modal, Stack, Text, Loader, Center, Paper, Group, SegmentedControl, SimpleGrid, Alert } from '@mantine/core';
import { LineChart, BarChart } from '@mantine/charts';
import { IconAlertCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { getMonthlyPayments, ApiError } from '../api/client';
import { formatCurrency, formatCurrencyAxis, getLocale } from '../lib/currency';

interface MonthlyTotalsChartProps {
  opened: boolean;
  onClose: () => void;
}

interface ChartData {
  month: string;
  label: string;
  total: number;
}

export function MonthlyTotalsChart({ opened, onClose }: MonthlyTotalsChartProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<string>('bar');
  const [monthRange, setMonthRange] = useState<string>('12');

  useEffect(() => {
    if (opened) {
      fetchData();
      window.umami?.track('view_spending_trends');
    }
  }, [opened]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getMonthlyPayments();
      const monthlyData = response ?? {};

      // Generate last 12 months of data
      const months: ChartData[] = [];
      const now = new Date();

      for (let i = 11; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const key = `${year}-${month}`;
        const label = date.toLocaleDateString(getLocale(), { month: 'short', year: '2-digit' });

        // API returns {deposits, expenses} per month - use expenses for spending trends
        const monthData = monthlyData[key];
        const total = monthData ? monthData.expenses : 0;

        months.push({
          month: key,
          label,
          total,
        });
      }

      setData(months);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('monthlyTotalsChart.errorLoadDefault');
      setError(message);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  // Filter data based on selected range
  const displayData = monthRange === '6' ? data.slice(-6) : data;
  const totalSpent = displayData.reduce((sum, d) => sum + d.total, 0);
  const avgMonthly = displayData.length > 0 ? totalSpent / displayData.filter(d => d.total > 0).length : 0;
  const maxMonth = displayData.reduce((max, d) => d.total > max.total ? d : max, { total: 0, label: t('common.notApplicable') } as ChartData);
  const minMonth = displayData.filter(d => d.total > 0).reduce((min, d) => d.total < min.total ? d : min, { total: Infinity, label: t('common.notApplicable') } as ChartData);

  return (
    <Modal opened={opened} onClose={onClose} title={t('monthlyTotalsChart.title')} size="xl" centered>
      <Stack gap="md">
        {loading ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : error ? (
          <Alert icon={<IconAlertCircle size={16} />} title={t('monthlyTotalsChart.errorLoadTitle')} color="red">
            {error}
          </Alert>
        ) : data.length === 0 || totalSpent === 0 ? (
          <Paper p="xl" withBorder>
            <Text ta="center" c="dimmed">
              {t('common.noPaymentData')}
            </Text>
          </Paper>
        ) : (
          <>
            {/* Controls */}
            <Group justify="space-between">
              <SegmentedControl
                size="xs"
                value={monthRange}
                onChange={setMonthRange}
                data={[
                  { value: '6', label: t('monthlyTotalsChart.sixMonths') },
                  { value: '12', label: t('monthlyTotalsChart.twelveMonths') },
                ]}
              />
              <SegmentedControl
                size="xs"
                value={chartType}
                onChange={setChartType}
                data={[
                  { value: 'bar', label: t('monthlyTotalsChart.chartTypeBar') },
                  { value: 'line', label: t('monthlyTotalsChart.chartTypeLine') },
                ]}
              />
            </Group>

            {/* Stats */}
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">{t('monthlyTotalsChart.totalSpent')}</Text>
                <Text size="lg" fw={700} c="violet">{formatCurrency(totalSpent)}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">{t('monthlyTotalsChart.monthlyAvg')}</Text>
                <Text size="lg" fw={700} c="blue">{formatCurrency(avgMonthly)}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">{t('monthlyTotalsChart.highest')}</Text>
                <Text size="lg" fw={700} c="red">{formatCurrency(maxMonth.total)}</Text>
                <Text size="xs" c="dimmed">{maxMonth.label}</Text>
              </Paper>
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed">{t('monthlyTotalsChart.lowest')}</Text>
                <Text size="lg" fw={700} c="green">{formatCurrency(minMonth.total === Infinity ? 0 : minMonth.total)}</Text>
                <Text size="xs" c="dimmed">{minMonth.total === Infinity ? t('common.notApplicable') : minMonth.label}</Text>
              </Paper>
            </SimpleGrid>

            {/* Chart */}
            <Paper p="md" withBorder>
              {chartType === 'bar' ? (
                <BarChart
                  h={300}
                  data={displayData}
                  dataKey="label"
                  series={[{ name: 'total', color: 'violet.6', label: t('monthlyTotalsChart.totalPaidSeries') }]}
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
              ) : (
                <LineChart
                  h={300}
                  data={displayData}
                  dataKey="label"
                  series={[{ name: 'total', color: 'violet.6', label: t('monthlyTotalsChart.totalPaidSeries') }]}
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
              )}
            </Paper>
          </>
        )}
      </Stack>
    </Modal>
  );
}
