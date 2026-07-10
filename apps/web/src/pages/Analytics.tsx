import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import '@mantine/charts/styles.css';
import {
  ActionIcon,
  Alert,
  Box,
  Center,
  Collapse,
  Divider,
  Grid,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { AreaChart, BarChart } from '@mantine/charts';
import {
  IconAlertCircle,
  IconChartPie,
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconTrendingDown,
  IconTrendingUp,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AccountPieChart } from '../components/Analytics/AccountPieChart';
import { YoYComparison } from '../components/Analytics/YoYComparison';
import { CashFlowForecast } from '../components/Dashboard/CashFlowForecast';
import { useAuth } from '../context/AuthContext';
import { getAllPayments, getMonthlyComparison, getStatsByAccount, getStatsYearly } from '../api/client';
import type { AccountStats, MonthlyComparison as MonthlyComparisonType, PaymentWithBill, YearlyStats } from '../api/client';
import { formatCurrency, formatCurrencyAxis, getLocale } from '../lib/currency';

interface AnalyticsProps {
  hasDatabase: boolean;
  currentDb?: string | null;
}

interface CategoryChartData {
  month: string;
  label: string;
  total: number;
  [key: string]: string | number;
}

interface CategorySeries {
  name: string;
  label: string;
  color: string;
}

type SectionId = 'summary' | 'spending-trends' | 'cash-flow' | 'accounts' | 'yearly';

interface AnalyticsLayout {
  order: SectionId[];
  collapsed: SectionId[];
}

interface AnalyticsSection {
  id: SectionId;
  title: string;
  description?: string;
  content: ReactNode;
}

const DEFAULT_SECTION_ORDER: SectionId[] = ['summary', 'spending-trends', 'cash-flow', 'accounts', 'yearly'];

const CATEGORY_COLORS = [
  'violet.6',
  'blue.6',
  'teal.6',
  'green.6',
  'yellow.6',
  'orange.6',
  'red.6',
  'pink.6',
  'grape.6',
  'cyan.6',
  'indigo.6',
  'lime.6',
];

function normalizeLayout(value: Partial<AnalyticsLayout> | null | undefined): AnalyticsLayout {
  const providedOrder = Array.isArray(value?.order) ? value.order : [];
  const order = [
    ...providedOrder.filter((id): id is SectionId => DEFAULT_SECTION_ORDER.includes(id as SectionId)),
    ...DEFAULT_SECTION_ORDER.filter((id) => !providedOrder.includes(id)),
  ];
  const collapsed = Array.isArray(value?.collapsed)
    ? value.collapsed.filter((id): id is SectionId => DEFAULT_SECTION_ORDER.includes(id as SectionId))
    : [];

  return { order, collapsed };
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function paymentMonthKey(paymentDate: string): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(paymentDate);
  return match ? `${match[1]}-${match[2]}` : null;
}

function categoryLabel(payment: PaymentWithBill, t: TFunction): string {
  return payment.category?.trim() || t('analyticsPage.uncategorized');
}

function SectionShell({
  section,
  collapsed,
  isDragging,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  section: AnalyticsSection;
  collapsed: boolean;
  isDragging: boolean;
  onToggle: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      onDragOver={onDragOver}
      onDrop={onDrop}
      opacity={isDragging ? 0.65 : 1}
      style={{ transition: 'opacity 120ms ease, border-color 120ms ease' }}
    >
      <Group justify="space-between" align="flex-start" mb={collapsed ? 0 : 'md'}>
        <Group
          gap="sm"
          wrap="nowrap"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          style={{ cursor: 'grab', flex: 1, minWidth: 0 }}
        >
          <ActionIcon variant="subtle" color="gray" aria-label={t('analyticsPage.moveAriaLabel', { title: section.title })}>
            <IconGripVertical size={18} />
          </ActionIcon>
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Title order={5}>{section.title}</Title>
            {section.description && (
              <Text size="sm" c="dimmed">
                {section.description}
              </Text>
            )}
          </Stack>
        </Group>
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={onToggle}
          aria-label={collapsed ? t('analyticsPage.expandAriaLabel', { title: section.title }) : t('analyticsPage.collapseAriaLabel', { title: section.title })}
        >
          {collapsed ? <IconChevronDown size={18} /> : <IconChevronUp size={18} />}
        </ActionIcon>
      </Group>

      <Collapse expanded={!collapsed}>{section.content}</Collapse>
    </Paper>
  );
}

export function Analytics({ hasDatabase, currentDb }: AnalyticsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [accountStats, setAccountStats] = useState<AccountStats[]>([]);
  const [yearlyStats, setYearlyStats] = useState<YearlyStats | null>(null);
  const [monthlyComparison, setMonthlyComparison] = useState<MonthlyComparisonType | null>(null);
  const [payments, setPayments] = useState<PaymentWithBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<string>('bar');
  const [monthRange, setMonthRange] = useState<string>('12');
  const [draggingSectionId, setDraggingSectionId] = useState<SectionId | null>(null);
  const [layout, setLayout] = useState<AnalyticsLayout>(() => normalizeLayout(null));

  const storageKey = useMemo(() => {
    const userKey = user?.id ?? 'anonymous';
    const dbKey = currentDb ?? 'none';
    return `billmanager:analytics-layout:${userKey}:${dbKey}`;
  }, [currentDb, user?.id]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      setLayout(normalizeLayout(saved ? JSON.parse(saved) : null));
    } catch {
      setLayout(normalizeLayout(null));
    }
  }, [storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [layout, storageKey]);

  useEffect(() => {
    if (hasDatabase) {
      loadData();
    }
  }, [hasDatabase, currentDb]);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [accounts, yearly, comparison, allPayments] = await Promise.all([
        getStatsByAccount().catch(() => []),
        getStatsYearly().catch(() => ({})),
        getMonthlyComparison().catch(() => null),
        getAllPayments().catch(() => []),
      ]);

      setAccountStats(accounts);
      setYearlyStats(yearly);
      setMonthlyComparison(comparison);
      setPayments(Array.isArray(allPayments) ? allPayments : []);
    } catch (err) {
      setError(t('analyticsPage.loadFailed'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const trend = useMemo(() => {
    const now = new Date();
    const rows: CategoryChartData[] = [];
    const rowByMonth = new Map<string, CategoryChartData>();
    const categoryTotals = new Map<string, number>();

    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(date);
      const row: CategoryChartData = {
        month: key,
        label: date.toLocaleDateString(getLocale(), { month: 'short', year: '2-digit' }),
        total: 0,
      };
      rows.push(row);
      rowByMonth.set(key, row);
    }

    payments.forEach((payment) => {
      if (payment.bill_type === 'deposit' || payment.is_received_payment) {
        return;
      }

      const key = paymentMonthKey(payment.payment_date);
      const row = key ? rowByMonth.get(key) : null;
      if (!row) {
        return;
      }

      const category = categoryLabel(payment, t);
      const amount = Number(payment.amount) || 0;
      row.total += amount;
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + amount);
    });

    const categories = [...categoryTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category]) => category);

    const series: CategorySeries[] = categories.map((category, index) => {
      const key = `category_${index}`;
      rows.forEach((row) => {
        row[key] = 0;
      });
      return {
        name: key,
        label: category,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      };
    });

    const keyByCategory = new Map(categories.map((category, index) => [category, `category_${index}`]));

    payments.forEach((payment) => {
      if (payment.bill_type === 'deposit' || payment.is_received_payment) {
        return;
      }

      const key = paymentMonthKey(payment.payment_date);
      const row = key ? rowByMonth.get(key) : null;
      if (!row) {
        return;
      }

      const categoryKey = keyByCategory.get(categoryLabel(payment, t));
      if (!categoryKey) {
        return;
      }

      row[categoryKey] = Number(row[categoryKey] ?? 0) + (Number(payment.amount) || 0);
    });

    return { rows, series };
  }, [payments, t]);

  const displayData = monthRange === '6' ? trend.rows.slice(-6) : trend.rows;
  const totalSpent = displayData.reduce((sum, item) => sum + item.total, 0);
  const monthsWithData = displayData.filter((item) => item.total > 0);
  const avgMonthly = monthsWithData.length > 0 ? totalSpent / monthsWithData.length : 0;
  const maxMonth = displayData.reduce(
    (max, item) => (item.total > max.total ? item : max),
    { total: 0, label: t('common.notApplicable') } as CategoryChartData
  );
  const minMonth = monthsWithData.length > 0
    ? monthsWithData.reduce(
        (min, item) => (item.total < min.total ? item : min),
        { total: Infinity, label: t('common.notApplicable') } as CategoryChartData
      )
    : ({ total: 0, label: t('common.notApplicable') } as CategoryChartData);

  const yearlyEntries = yearlyStats ? Object.entries(yearlyStats).sort((a, b) => b[0].localeCompare(a[0])) : [];
  const currentYearData = yearlyEntries[0];
  const lastYearData = yearlyEntries[1];
  const currentYearTotal = currentYearData ? currentYearData[1].expenses : 0;
  const lastYearTotal = lastYearData ? lastYearData[1].expenses : 0;
  const yoyChange = lastYearTotal > 0 ? ((currentYearTotal - lastYearTotal) / lastYearTotal) * 100 : 0;

  const moveSection = (targetId: SectionId) => {
    if (!draggingSectionId || draggingSectionId === targetId) {
      return;
    }

    setLayout((current) => {
      const nextOrder = [...current.order];
      const fromIndex = nextOrder.indexOf(draggingSectionId);
      const toIndex = nextOrder.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) {
        return current;
      }
      const [moved] = nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, moved);
      return { ...current, order: nextOrder };
    });
  };

  const toggleCollapsed = (id: SectionId) => {
    setLayout((current) => ({
      ...current,
      collapsed: current.collapsed.includes(id)
        ? current.collapsed.filter((item) => item !== id)
        : [...current.collapsed, id],
    }));
  };

  if (!hasDatabase) {
    return (
      <Center py="xl">
        <Paper withBorder p="xl" radius="md" ta="center" maw={400}>
          <IconChartPie size={48} color="var(--mantine-color-dimmed)" />
          <Title order={3} mt="md">
            {t('dashboardPage.noBillGroupTitle')}
          </Title>
          <Text c="dimmed" mt="sm">
            {t('analyticsPage.noBillGroupBody')}
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

  const chartTooltip = ({ payload }: { payload?: readonly { payload?: CategoryChartData }[] }) => {
    if (!payload || payload.length === 0) return null;
    const item = payload[0]?.payload;
    if (!item) return null;
    return (
      <Paper px="md" py="sm" withBorder shadow="md" radius="md">
        <Text fw={600}>{item.label}</Text>
        <Text size="sm" c="dimmed" mb="xs">
          {formatCurrency(item.total)}
        </Text>
        <Stack gap={3}>
          {trend.series
            .map((series) => ({ ...series, value: Number(item[series.name] ?? 0) }))
            .filter((series) => series.value > 0)
            .map((series) => (
              <Group key={series.name} gap="xs" justify="space-between" wrap="nowrap">
                <Text size="xs">{series.label}</Text>
                <Text size="xs" fw={600}>{formatCurrency(series.value)}</Text>
              </Group>
            ))}
        </Stack>
      </Paper>
    );
  };

  const sections: AnalyticsSection[] = [
    {
      id: 'summary',
      title: t('analyticsPage.summaryTitle'),
      content: (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {currentYearData && (
            <Paper withBorder p="md" radius="md">
              <Group justify="space-between">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    {t('analyticsPage.expensesSuffix', { year: currentYearData[0] })}
                  </Text>
                  <Text fw={700} size="xl">
                    {formatCurrency(currentYearData[1].expenses)}
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
                    {t('analyticsPage.expensesSuffix', { year: lastYearData[0] })}
                  </Text>
                  <Text fw={700} size="xl">
                    {formatCurrency(lastYearData[1].expenses)}
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
                    {t('analyticsPage.yoyChangeLabel')}
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
      ),
    },
    {
      id: 'spending-trends',
      title: t('analyticsPage.spendingTrendsTitle'),
      description: t('analyticsPage.spendingTrendsDescription'),
      content: totalSpent > 0 ? (
        <Stack gap="md">
          <Group justify="space-between">
            <Group gap="sm">
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
          </Group>

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

          {chartType === 'bar' ? (
            <BarChart
              h={300}
              data={displayData}
              dataKey="label"
              series={trend.series}
              type="stacked"
              withLegend
              withTooltip
              tooltipProps={{ content: chartTooltip }}
              yAxisProps={{
                tickFormatter: (value: number) => formatCurrencyAxis(value),
              }}
            />
          ) : (
            <AreaChart
              h={300}
              data={displayData}
              dataKey="label"
              series={trend.series}
              type="stacked"
              curveType="monotone"
              fillOpacity={0.28}
              withDots={false}
              withLegend
              withTooltip
              tooltipProps={{ content: chartTooltip }}
              yAxisProps={{
                tickFormatter: (value: number) => formatCurrencyAxis(value),
              }}
            />
          )}
        </Stack>
      ) : (
        <Paper withBorder p="md" radius="sm" bg="var(--mantine-color-default)">
          <Text size="sm" c="dimmed">
            {t('analyticsPage.noCategorizedData')}
          </Text>
        </Paper>
      ),
    },
    {
      id: 'cash-flow',
      title: t('dashboard.cashFlowForecast.title'),
      description: t('dashboard.cashFlowForecast.description'),
      content: <CashFlowForecast hasDatabase={hasDatabase} framed={false} showHeader={false} />,
    },
    {
      id: 'accounts',
      title: t('analyticsPage.accountsTitle'),
      content: (
        <Grid>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <AccountPieChart data={accountStats} loading={loading} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <YoYComparison data={monthlyComparison} loading={loading} />
          </Grid.Col>
        </Grid>
      ),
    },
    {
      id: 'yearly',
      title: t('analyticsPage.yearlyTitle'),
      content: yearlyEntries.length > 0 ? (
        <SimpleGrid cols={{ base: 2, sm: 4, md: 6 }}>
          {yearlyEntries.map(([year, data]) => {
            const net = data.deposits - data.expenses;
            return (
              <Paper key={year} withBorder p="sm" radius="sm" bg="var(--mantine-color-default)">
                <Text size="sm" fw={700} mb={4}>{year}</Text>
                <Divider mb={4} />
                <Group justify="space-between" gap={4}>
                  <Text size="xs" c="dimmed">{t('analyticsPage.expensesLabel')}</Text>
                  <Text size="sm" fw={600} c="red">-{formatCurrency(data.expenses)}</Text>
                </Group>
                {data.deposits > 0 && (
                  <Group justify="space-between" gap={4}>
                    <Text size="xs" c="dimmed">{t('dayDetailModal.depositsHeader')}</Text>
                    <Text size="sm" fw={600} c="green">+{formatCurrency(data.deposits)}</Text>
                  </Group>
                )}
                <Divider my={4} />
                <Group justify="space-between" gap={4}>
                  <Text size="xs" fw={600}>{t('analyticsPage.netLabel')}</Text>
                  <Text size="sm" fw={700} c={net >= 0 ? 'green' : 'red'}>
                    {net >= 0 ? '+' : '-'}{formatCurrency(Math.abs(net))}
                  </Text>
                </Group>
              </Paper>
            );
          })}
        </SimpleGrid>
      ) : (
        <Text size="sm" c="dimmed">{t('analyticsPage.noYearlyData')}</Text>
      ),
    },
  ];

  const sectionById = new Map(sections.map((section) => [section.id, section]));

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Title order={2}>{t('analyticsPage.title')}</Title>
      </Group>

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red">
          {error}
        </Alert>
      )}

      <Box>
        <Stack gap="md">
          {layout.order.map((id) => {
            const section = sectionById.get(id);
            if (!section) {
              return null;
            }

            return (
              <SectionShell
                key={section.id}
                section={section}
                collapsed={layout.collapsed.includes(section.id)}
                isDragging={draggingSectionId === section.id}
                onToggle={() => toggleCollapsed(section.id)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  setDraggingSectionId(section.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  moveSection(section.id);
                }}
                onDragEnd={() => setDraggingSectionId(null)}
              />
            );
          })}
        </Stack>
      </Box>
    </Stack>
  );
}
