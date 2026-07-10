import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconCash,
  IconCheck,
  IconRefresh,
  IconShare,
  IconUser,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as api from '../api/client';
import type { SettlementItem, SettlementsResponse } from '../api/client';
import { BillIcon } from '../components/BillIcon';
import { formatCurrency, getLocale } from '../lib/currency';

interface SettlementsProps {
  hasDatabase: boolean;
}

function formatDate(dateStr: string | null | undefined, t: TFunction): string {
  if (!dateStr) return t('settlementsPage.noDate');
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return dateStr;
  }
  const [year, month, day] = parts;
  return new Date(year, month - 1, day).toLocaleDateString(getLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function dueBadge(item: SettlementItem, t: TFunction) {
  if (item.paid) {
    return <Badge color="green" variant="light">{t('sharedBillsSection.paid')}</Badge>;
  }
  if (item.due_status === 'overdue') {
    return <Badge color="red">{t('dashboard.statCards.overdue')}</Badge>;
  }
  if (item.due_status === 'due_today') {
    return <Badge color="orange">{t('settlementsPage.statusDueToday')}</Badge>;
  }
  if (item.days_until_due !== null && item.days_until_due <= 7) {
    return <Badge color="yellow" variant="light">{t('settlementsPage.statusDueSoon')}</Badge>;
  }
  return <Badge color="gray" variant="light">{t('settlementsPage.statusOpen')}</Badge>;
}

function splitLabel(item: SettlementItem, t: TFunction): string {
  if (!item.split_type) return t('settlementsPage.splitFullAmount');
  if (item.split_type === 'equal') return t('settlementsPage.splitEqual');
  if (item.split_type === 'percentage') return t('settlementsPage.splitPercentage', { value: item.split_value ?? 0 });
  return t('settlementsPage.splitFixed', { amount: formatCurrency(item.split_value) });
}

function StatCard({
  label,
  value,
  color,
  icon,
  detail,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ReactNode;
  detail?: string;
}) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Text size="sm" c="dimmed">{label}</Text>
          <Text size="xl" fw={700}>{value}</Text>
          {detail && <Text size="xs" c="dimmed">{detail}</Text>}
        </Stack>
        <ThemeIcon color={color} variant="light" size="lg">
          {icon}
        </ThemeIcon>
      </Group>
    </Paper>
  );
}

function SettlementCard({
  item,
  actionLoading,
  onMarkPaid,
}: {
  item: SettlementItem;
  actionLoading: number | null;
  onMarkPaid?: (shareId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" align="flex-start">
            <BillIcon icon={item.bill_icon} size={36} />
            <Stack gap={2}>
              <Group gap="xs">
                <Text fw={600}>{item.bill_name}</Text>
                {dueBadge(item, t)}
              </Group>
              <Group gap={6}>
                <IconUser size={13} />
                <Text size="sm" c="dimmed">{item.counterparty_name}</Text>
                {item.database_name && (
                  <Badge size="xs" color="gray" variant="light">{item.database_name}</Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {t('settlementsPage.dueDatePrefix', { date: formatDate(item.due_date, t), split: splitLabel(item, t) })}
              </Text>
            </Stack>
          </Group>
          <Stack gap={2} align="flex-end">
            <Text fw={700} size="lg">{formatCurrency(item.amount)}</Text>
            {item.total_amount !== null && item.total_amount !== item.amount && (
              <Text size="xs" c="dimmed">{t('sharedBillsSection.ofAmount', { amount: formatCurrency(item.total_amount) })}</Text>
            )}
          </Stack>
        </Group>

        {onMarkPaid && (
          <>
            <Divider />
            <Group justify="flex-end">
              <Button
                size="xs"
                leftSection={<IconCheck size={14} />}
                loading={actionLoading === item.share_id}
                onClick={() => onMarkPaid(item.share_id)}
              >
                {t('settlementsPage.markPaidButton')}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function SettlementColumn({
  title,
  empty,
  items,
  actionLoading,
  onMarkPaid,
}: {
  title: string;
  empty: string;
  items: SettlementItem[];
  actionLoading: number | null;
  onMarkPaid?: (shareId: number) => void;
}) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={4}>{title}</Title>
          <Badge variant="light">{items.length}</Badge>
        </Group>
        {items.length === 0 ? (
          <Text size="sm" c="dimmed">{empty}</Text>
        ) : (
          <Stack gap="sm">
            {items.map((item) => (
              <SettlementCard
                key={`${item.direction}-${item.share_id}`}
                item={item}
                actionLoading={actionLoading}
                onMarkPaid={onMarkPaid}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

export function Settlements({ hasDatabase }: SettlementsProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<SettlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const loadSettlements = useCallback(async () => {
    if (!hasDatabase) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.getSettlements();
      setData(response);
    } catch {
      setError(t('settlementsPage.loadFailed'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [hasDatabase, t]);

  useEffect(() => {
    loadSettlements();
  }, [loadSettlements]);

  const handleMarkPaid = async (shareId: number) => {
    setActionLoading(shareId);
    try {
      await api.markSharePaid(shareId);
      notifications.show({
        message: t('settlementsPage.markPaidSuccess'),
        color: 'green',
      });
      await loadSettlements();
    } catch {
      notifications.show({
        title: t('settlementsPage.markPaidFailedTitle'),
        message: t('settlementsPage.markPaidFailedBody'),
        color: 'red',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const netColor = useMemo(() => {
    if (!data || data.summary.net_balance === 0) return 'gray';
    return data.summary.net_balance > 0 ? 'green' : 'red';
  }, [data]);

  if (!hasDatabase) {
    return (
      <Center py="xl">
        <Text c="dimmed">{t('settlementsPage.hasDatabaseEmptyBody')}</Text>
      </Center>
    );
  }

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Title order={2}>{t('settlementsPage.title')}</Title>
          <Text c="dimmed">{t('settlementsPage.subtitle')}</Text>
        </Stack>
        <ActionIcon variant="light" size="lg" onClick={loadSettlements} title={t('settlementsPage.refreshTooltip')}>
          <IconRefresh size={18} />
        </ActionIcon>
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {error}
        </Alert>
      )}

      {data && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <StatCard
              label={t('settlementsPage.owedToMe')}
              value={formatCurrency(data.summary.owed_to_me)}
              color="green"
              icon={<IconArrowUpRight size={18} />}
              detail={t('settlementsPage.overdueCount', { count: data.summary.overdue_owed_to_me })}
            />
            <StatCard
              label={t('settlementsPage.iOwe')}
              value={formatCurrency(data.summary.i_owe)}
              color="red"
              icon={<IconArrowDownRight size={18} />}
              detail={t('settlementsPage.overdueCount', { count: data.summary.overdue_i_owe })}
            />
            <StatCard
              label={t('settlementsPage.netBalance')}
              value={formatCurrency(data.summary.net_balance)}
              color={netColor}
              icon={<IconCash size={18} />}
              detail={data.summary.net_balance >= 0 ? t('settlementsPage.netReceivable') : t('settlementsPage.netPayable')}
            />
            <StatCard
              label={t('settlementsPage.openShares')}
              value={String(data.summary.open_count)}
              color="blue"
              icon={<IconShare size={18} />}
              detail={t('settlementsPage.settledCount', { count: data.summary.settled_count })}
            />
          </SimpleGrid>

          {data.summary.open_count === 0 && data.summary.settled_count === 0 && (
            <Alert color="blue" variant="light" icon={<IconShare size={16} />}>
              {t('settlementsPage.noActivity')}
            </Alert>
          )}

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <SettlementColumn
              title={t('settlementsPage.owedToMe')}
              empty={t('settlementsPage.noOneOwesYou')}
              items={data.owed_to_me}
              actionLoading={actionLoading}
            />
            <SettlementColumn
              title={t('settlementsPage.iOwe')}
              empty={t('settlementsPage.noOpenBalances')}
              items={data.i_owe}
              actionLoading={actionLoading}
              onMarkPaid={handleMarkPaid}
            />
          </SimpleGrid>

          {data.people.length > 0 && (
            <Paper withBorder p="md" radius="md">
              <Stack gap="md">
                <Title order={4}>{t('settlementsPage.byPersonTitle')}</Title>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('settlementsPage.personColumn')}</Table.Th>
                      <Table.Th>{t('settlementsPage.owedToMe')}</Table.Th>
                      <Table.Th>{t('settlementsPage.iOwe')}</Table.Th>
                      <Table.Th>{t('settlementsPage.netColumn')}</Table.Th>
                      <Table.Th>{t('settlementsPage.openColumn')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.people.map((person) => (
                      <Table.Tr key={person.counterparty_name}>
                        <Table.Td>{person.counterparty_name}</Table.Td>
                        <Table.Td>{formatCurrency(person.owed_to_me)}</Table.Td>
                        <Table.Td>{formatCurrency(person.i_owe)}</Table.Td>
                        <Table.Td>
                          <Text c={person.net >= 0 ? 'green' : 'red'} fw={600}>
                            {formatCurrency(person.net)}
                          </Text>
                        </Table.Td>
                        <Table.Td>{person.open_count}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Paper>
          )}

          {data.settled.length > 0 && (
            <Paper withBorder p="md" radius="md">
              <Stack gap="md">
                <Title order={4}>{t('settlementsPage.recentlySettledTitle')}</Title>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('dashboard.cashFlowForecast.columns.bill')}</Table.Th>
                      <Table.Th>{t('settlementsPage.personColumn')}</Table.Th>
                      <Table.Th>{t('common.table.amount')}</Table.Th>
                      <Table.Th>{t('settlementsPage.paidColumn')}</Table.Th>
                      <Table.Th>{t('settlementsPage.directionColumn')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.settled.map((item) => (
                      <Table.Tr key={`settled-${item.direction}-${item.share_id}`}>
                        <Table.Td>
                          <Group gap="xs">
                            <BillIcon icon={item.bill_icon} size={24} />
                            <Text size="sm">{item.bill_name}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>{item.counterparty_name}</Table.Td>
                        <Table.Td>{formatCurrency(item.amount)}</Table.Td>
                        <Table.Td>{formatDate(item.paid_date?.slice(0, 10), t)}</Table.Td>
                        <Table.Td>
                          <Badge color={item.direction === 'owed_to_me' ? 'green' : 'red'} variant="light">
                            {item.direction === 'owed_to_me' ? t('settlementsPage.received') : t('sharedBillsSection.paid')}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}
