import { Paper, Title, Text, Group, Button, Table, Badge, ThemeIcon, ActionIcon, Tooltip } from '@mantine/core';
import { IconCalendar, IconCash, IconEdit, IconUsers } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Bill } from '../../api/client';
import { BillIcon } from '../BillIcon';
import { formatCurrency } from '../../lib/currency';
import { formatDateString } from '../../utils/date';

interface UpcomingBillsListProps {
  bills: Bill[];
  onPay: (bill: Bill) => void;
  onEdit: (bill: Bill) => void;
  onViewPayments: (bill: Bill) => void;
  onViewAll: () => void;
}

// Parse date string directly to avoid timezone issues
function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getDueBadgeColor(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = parseDate(dateStr);
  dueDate.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'red';
  if (diffDays <= 7) return 'red';
  if (diffDays <= 14) return 'orange';
  if (diffDays <= 21) return 'yellow';
  if (diffDays <= 30) return 'blue';
  return 'gray';
}

function getFrequencyText(bill: Bill, t: TFunction): string {
  let frequencyConfig: { dates?: number[]; days?: number[] } = {};
  try { frequencyConfig = bill.frequency_config ? JSON.parse(bill.frequency_config) : {}; } catch { /* ignore malformed config */ }

  switch (bill.frequency) {
    case 'weekly':
      return t('common.frequency.weekly');
    case 'bi-weekly':
    case 'biweekly':
      return t('common.frequency.biweekly');
    case 'quarterly':
      return t('common.frequency.quarterly');
    case 'yearly':
      return t('common.frequency.yearly');
    case 'monthly':
      if (bill.frequency_type === 'specific_dates' && frequencyConfig.dates) {
        const dates = frequencyConfig.dates.join(', ') + (frequencyConfig.dates.length === 1 ? 'st/nd/rd/th' : '');
        return t('common.frequency.monthlyOnDates', { dates });
      }
      return t('common.frequency.monthly');
    case 'custom':
      if (bill.frequency_type === 'multiple_weekly' && frequencyConfig.days) {
        const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
        const days = frequencyConfig.days.map((d: number) => t(`common.weekdaysShort.${dayKeys[d]}`)).join(', ');
        return t('common.frequency.customWeekly', { days });
      }
      return t('common.frequency.custom');
    default:
      return bill.frequency;
  }
}

export function UpcomingBillsList({ bills, onPay, onEdit, onViewPayments, onViewAll }: UpcomingBillsListProps) {
  const { t } = useTranslation();

  // Get today's date at midnight
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter and sort upcoming bills (next 7 days, not archived)
  const oneDay = 24 * 60 * 60 * 1000;
  const weekFromNow = new Date(today.getTime() + 7 * oneDay);

  const upcomingBills = bills
    .filter((b) => {
      if (b.archived) return false;
      const due = parseDate(b.next_due);
      return due >= today && due < weekFromNow;
    })
    .sort((a, b) => parseDate(a.next_due).getTime() - parseDate(b.next_due).getTime());

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <ThemeIcon color="blue" variant="light" size="md" radius="md">
            <IconCalendar size={16} />
          </ThemeIcon>
          <Title order={5}>{t('dashboard.upcomingBills.title')}</Title>
        </Group>
        <Button variant="subtle" size="xs" onClick={onViewAll}>
          {t('common.actions.viewAll')}
        </Button>
      </Group>

      {upcomingBills.length === 0 ? (
        <Text c="dimmed" ta="center" py="md">
          {t('dashboard.upcomingBills.empty')}
        </Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('common.table.name')}</Table.Th>
              <Table.Th>{t('common.table.amount')}</Table.Th>
              <Table.Th>{t('common.table.dueDate')}</Table.Th>
              <Table.Th>{t('common.table.frequency')}</Table.Th>
              <Table.Th>{t('common.table.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {upcomingBills.map((bill) => (
              <Table.Tr
                key={bill.id}
                style={{ cursor: 'pointer' }}
                onClick={() => onViewPayments(bill)}
              >
                <Table.Td>
                  <Group gap="sm">
                    <BillIcon icon={bill.icon} size={24} />
                    <div>
                      <Group gap={6} align="center">
                        <Text fw={500}>{bill.name}</Text>
                        {(bill.is_shared || (bill.share_count && bill.share_count > 0)) && (
                          <Tooltip
                            label={
                              bill.is_shared
                                ? t('common.sharedWithYouBy', { name: bill.share_info?.owner_name })
                                : t('common.sharedWithCount', { count: bill.share_count ?? 0 })
                            }
                            withArrow
                          >
                            <ThemeIcon
                              size="xs"
                              radius="xl"
                              variant="light"
                              color={bill.is_shared ? 'violet' : 'blue'}
                              style={{ cursor: 'help' }}
                            >
                              <IconUsers size={12} />
                            </ThemeIcon>
                          </Tooltip>
                        )}
                      </Group>
                      <Group gap={4}>
                        <Badge
                          size="xs"
                          color={bill.type === 'deposit' ? 'green' : 'blue'}
                          variant="light"
                        >
                          {bill.type === 'deposit' ? t('common.billType.deposit') : t('common.billType.expense')}
                        </Badge>
                        {bill.is_shared && bill.share_info && (
                          <Badge size="xs" color="violet" variant="filled">
                            {t('common.fromOwner', { name: bill.share_info.owner_name })}
                          </Badge>
                        )}
                        {bill.account && (
                          <Badge size="xs" variant="dot" color="cyan">
                            {bill.account}
                          </Badge>
                        )}
                        {!!bill.auto_payment && (
                          <Badge size="xs" color="green" variant="light">
                            {t('common.autoPay')}
                          </Badge>
                        )}
                      </Group>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td>
                  {bill.varies ? (
                    <Text c={bill.type === 'deposit' ? 'green' : 'red'}>
                      {t('common.varies')}{' '}
                      <Text span size="xs">
                        (~{formatCurrency(bill.avg_amount || 0)})
                      </Text>
                    </Text>
                  ) : (
                    <Text fw={500} c={bill.type === 'deposit' ? 'green' : 'red'}>
                      {formatCurrency(bill.amount || 0)}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge color={getDueBadgeColor(bill.next_due)} variant="light">
                    {formatDateString(bill.next_due)}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {getFrequencyText(bill, t)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" onClick={(e) => e.stopPropagation()}>
                    {!bill.is_shared && (
                      <>
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          onClick={() => onEdit(bill)}
                          title={t('common.actions.edit')}
                        >
                          <IconEdit size={18} />
                        </ActionIcon>
                        <ActionIcon
                          variant="filled"
                          color="green"
                          onClick={() => onPay(bill)}
                          title={t('common.actions.pay')}
                        >
                          <IconCash size={18} />
                        </ActionIcon>
                      </>
                    )}
                    {bill.is_shared && (
                      <ActionIcon
                        variant="filled"
                        color="green"
                        onClick={() => onPay(bill)}
                        title={t('common.markMyPortionPaid')}
                      >
                        <IconCash size={18} />
                      </ActionIcon>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}
