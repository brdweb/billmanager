import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import '@mantine/charts/styles.css';
import {
  Alert,
  Badge,
  Center,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { LineChart } from '@mantine/charts';
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconCalendarStats,
  IconCash,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import * as api from '../../api/client';
import type { CashFlowForecast as CashFlowForecastData } from '../../api/client';
import { BillIcon } from '../BillIcon';
import {
  formatCurrency,
  formatCurrencyAxis,
  getCurrencyInputProps,
} from '../../lib/currency';
import { formatDateShort } from '../../utils/date';

interface CashFlowForecastProps {
  hasDatabase: boolean;
  framed?: boolean;
  showHeader?: boolean;
}

const STORAGE_KEY = 'billmanager:forecast-starting-balance';

function SummaryMetric({
  label,
  value,
  detail,
  color,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  color: string;
  icon: ReactNode;
}) {
  return (
    <Group gap="sm" align="flex-start" wrap="nowrap">
      <ThemeIcon color={color} variant="light" size="lg" radius="md">
        {icon}
      </ThemeIcon>
      <Stack gap={2}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{label}</Text>
        <Text fw={700} size="lg">{value}</Text>
        <Text size="xs" c="dimmed">{detail}</Text>
      </Stack>
    </Group>
  );
}

export function CashFlowForecast({ hasDatabase, framed = true, showHeader = true }: CashFlowForecastProps) {
  const { t } = useTranslation();
  const [startingBalance, setStartingBalance] = useState<number>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? Number(saved) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const [days, setDays] = useState('60');
  const [forecast, setForecast] = useState<CashFlowForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(startingBalance));
  }, [startingBalance]);

  useEffect(() => {
    if (!hasDatabase) {
      return;
    }

    let cancelled = false;

    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setLoading(true);
        setError(false);
        return api.getCashFlowForecast(startingBalance, Number(days));
      })
      .then((response) => {
        if (!cancelled && response) setForecast(response);
      })
      .catch(() => {
        if (!cancelled) {
          setForecast(null);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasDatabase, startingBalance, days]);

  const chartData = useMemo(() => (
    forecast?.daily.map((day) => ({
      date: formatDateShort(day.date),
      balance: day.balance,
    })) ?? []
  ), [forecast]);

  if (!hasDatabase) return null;

  const content = (
      <Stack gap="md">
        <Group justify={showHeader ? 'space-between' : 'flex-end'} align={showHeader ? 'flex-start' : 'flex-end'}>
          {showHeader && (
            <Stack gap={2}>
              <Title order={4}>{t('dashboard.cashFlowForecast.title')}</Title>
              <Text size="sm" c="dimmed">
                {t('dashboard.cashFlowForecast.description')}
              </Text>
            </Stack>
          )}
          <Group gap="sm" align="flex-end">
            <NumberInput
              label={t('dashboard.cashFlowForecast.startingBalance')}
              {...getCurrencyInputProps()}
              value={startingBalance}
              onChange={(value) => setStartingBalance(typeof value === 'number' ? value : 0)}
              w={170}
            />
            <SegmentedControl
              value={days}
              onChange={setDays}
              data={[
                { label: t('dashboard.cashFlowForecast.days30'), value: '30' },
                { label: t('dashboard.cashFlowForecast.days60'), value: '60' },
                { label: t('dashboard.cashFlowForecast.days90'), value: '90' },
              ]}
            />
          </Group>
        </Group>

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
            {t('dashboard.cashFlowForecast.loadError')}
          </Alert>
        )}

        {loading && !forecast ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : forecast ? (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
              <SummaryMetric
                label={t('dashboard.cashFlowForecast.endingBalance')}
                value={formatCurrency(forecast.summary.ending_balance)}
                detail={t('dashboard.cashFlowForecast.dayProjection', { count: forecast.summary.days })}
                color={forecast.summary.ending_balance >= 0 ? 'green' : 'red'}
                icon={<IconCash size={18} />}
              />
              <SummaryMetric
                label={t('dashboard.cashFlowForecast.lowestBalance')}
                value={formatCurrency(forecast.summary.lowest_balance)}
                detail={formatDateShort(forecast.summary.lowest_balance_date)}
                color={forecast.summary.lowest_balance >= 0 ? 'blue' : 'red'}
                icon={<IconCalendarStats size={18} />}
              />
              <SummaryMetric
                label={t('dashboard.cashFlowForecast.income')}
                value={formatCurrency(forecast.summary.total_income)}
                detail={t('dashboard.cashFlowForecast.projectedDeposits')}
                color="green"
                icon={<IconArrowUpRight size={18} />}
              />
              <SummaryMetric
                label={t('dashboard.cashFlowForecast.expenses')}
                value={formatCurrency(forecast.summary.total_expenses)}
                detail={forecast.summary.runway_days === null
                  ? t('dashboard.cashFlowForecast.noNegativeBalance')
                  : t('dashboard.cashFlowForecast.negativeInDays', { count: forecast.summary.runway_days })}
                color={forecast.summary.runway_days === null ? 'orange' : 'red'}
                icon={<IconArrowDownRight size={18} />}
              />
            </SimpleGrid>

            {chartData.length > 1 && (
              <LineChart
                h={240}
                data={chartData}
                dataKey="date"
                series={[{
                  name: 'balance',
                  color: forecast.summary.lowest_balance < 0 ? 'red.6' : 'teal.6',
                  label: t('dashboard.cashFlowForecast.projectedBalance'),
                }]}
                curveType="linear"
                withTooltip
                yAxisProps={{
                  tickFormatter: (value: number) => formatCurrencyAxis(value),
                }}
              />
            )}

            {forecast.occurrences.length === 0 ? (
              <Text size="sm" c="dimmed">{t('dashboard.cashFlowForecast.noOccurrences')}</Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('common.table.date')}</Table.Th>
                    <Table.Th>{t('dashboard.cashFlowForecast.columns.bill')}</Table.Th>
                    <Table.Th>{t('common.table.type')}</Table.Th>
                    <Table.Th>{t('common.table.amount')}</Table.Th>
                    <Table.Th>{t('dashboard.cashFlowForecast.columns.balanceAfter')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {forecast.occurrences.slice(0, 6).map((item) => (
                    <Table.Tr key={`${item.source}-${item.share_id ?? item.bill_id}-${item.date}`}>
                      <Table.Td>{formatDateShort(item.date)}</Table.Td>
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          <BillIcon icon={item.bill_icon} size={24} />
                          <Stack gap={0}>
                            <Text size="sm" fw={500}>{item.bill_name}</Text>
                            <Text size="xs" c="dimmed">
                              {item.source === 'shared' && item.counterparty_name
                                ? t('common.sharedBy', { name: item.counterparty_name })
                                : item.database_name}
                            </Text>
                          </Stack>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={item.signed_amount >= 0 ? 'green' : 'red'} variant="light">
                          {item.signed_amount >= 0 ? t('common.billType.deposit') : t('common.billType.expense')}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text c={item.signed_amount >= 0 ? 'green' : 'red'} fw={600}>
                          {item.signed_amount >= 0 ? '+' : '-'}{formatCurrency(item.amount)}
                        </Text>
                      </Table.Td>
                      <Table.Td>{formatCurrency(item.balance_after)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </>
        ) : null}
      </Stack>
  );

  if (!framed) {
    return content;
  }

  return (
    <Paper withBorder p="md" radius="md">
      {content}
    </Paper>
  );
}
