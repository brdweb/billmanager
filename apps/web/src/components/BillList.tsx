import { useState, useEffect, useMemo } from 'react';
import {
  Table,
  Group,
  Text,
  Badge,
  ActionIcon,
  Paper,
  Button,
  Stack,
  Card,
  TextInput,
  Select,
  Menu,
  Pagination,
  Tooltip,
  ThemeIcon,
  Modal,
} from '@mantine/core';
import { IconEdit, IconCash, IconPlus, IconFilterOff, IconSearch, IconX, IconDownload, IconFileTypeCsv, IconFileTypePdf, IconPrinter, IconUsers, IconFilter } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { exportBillsToCSV, exportBillsToPDF, printBills } from '../utils/export';
import type { Bill } from '../api/client';
import { getAccounts, getCategories, markSharePaid } from '../api/client';
import { BillIcon } from './BillIcon';
import { formatCurrency } from '../lib/currency';
import { formatDateString } from '../utils/date';
import type { BillFilter } from '../App';

interface BillListProps {
  bills: Bill[];
  onEdit: (bill: Bill) => void;
  onPay: (bill: Bill) => void;
  onAdd: () => void;
  onViewPayments: (bill: Bill) => void;
  isLoggedIn: boolean;
  hasDatabase: boolean;
  hasActiveFilter?: boolean;
  onClearFilter?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  filter: BillFilter;
  onFilterChange: (filter: BillFilter) => void;
  onRefresh?: () => void;
  isAllBucketsMode?: boolean;
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

export function BillList({
  bills,
  onEdit,
  onPay,
  onAdd,
  onViewPayments,
  isLoggedIn,
  hasDatabase,
  hasActiveFilter,
  onClearFilter,
  searchQuery = '',
  onSearchChange,
  filter,
  onFilterChange,
  onRefresh,
  isAllBucketsMode = false,
}: BillListProps) {
  const { t } = useTranslation();
  // Accounts list for filtering
  const [accounts, setAccounts] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 15;

  // Confirmation modal state for shared bill payment
  const [confirmPayBill, setConfirmPayBill] = useState<Bill | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Handler for marking shared bill portion as paid
  const handleMarkPaid = async (bill: Bill) => {
    if (!bill.is_shared || !bill.share_info) return;

    setPaymentLoading(true);
    try {
      await markSharePaid(bill.share_info.share_id);
      notifications.show({
        title: t('billList.notifications.success'),
        message: bill.share_info.my_portion_paid ? t('billList.notifications.markedUnpaid') : t('billList.notifications.markedPaid'),
        color: 'green',
      });
      onRefresh?.();
      setConfirmPayBill(null);
    } catch {
      notifications.show({
        title: t('billList.notifications.error'),
        message: t('billList.notifications.updateFailed'),
        color: 'red',
      });
    } finally {
      setPaymentLoading(false);
    }
  };

  // Fetch accounts list when logged in
  useEffect(() => {
    if (isLoggedIn) {
      getAccounts()
        .then((res) => setAccounts(res))
        .catch((err) => console.error('Failed to fetch accounts:', err));
      getCategories()
        .then((res) => setCategories(res))
        .catch((err) => console.error('Failed to fetch categories:', err));
    }
  }, [isLoggedIn, bills]); // Refetch when bills change

  // Paginated bills - reset to page 1 if current page is out of bounds
  const totalPages = Math.ceil(bills.length / ITEMS_PER_PAGE);
  const validPage = currentPage > totalPages ? 1 : currentPage;
  const paginatedBills = useMemo(() => {
    const page = currentPage > Math.ceil(bills.length / ITEMS_PER_PAGE) ? 1 : currentPage;
    const start = (page - 1) * ITEMS_PER_PAGE;
    return bills.slice(start, start + ITEMS_PER_PAGE);
  }, [bills, currentPage]);
  if (!isLoggedIn) {
    return (
      <Card p="xl" withBorder>
        <Stack align="center" gap="md">
          <Text size="lg" c="dimmed">
            {t('billList.pleaseLogIn')}
          </Text>
        </Stack>
      </Card>
    );
  }

  if (!hasDatabase) {
    return (
      <Card p="xl" withBorder>
        <Stack align="center" gap="md">
          <Text size="lg" c="dimmed">
            {t('billList.noAccessTitle')}
          </Text>
          <Text size="sm" c="dimmed" ta="center">
            {t('billList.noAccessBody')}
          </Text>
        </Stack>
      </Card>
    );
  }

  if (bills.length === 0) {
    // Different messages for filtered vs unfiltered empty state
    if (hasActiveFilter) {
      return (
        <Card p="xl" withBorder>
          <Stack align="center" gap="md">
            <Text size="lg" c="dimmed">
              {t('billList.noMatchFilter')}
            </Text>
            {onClearFilter && (
              <Button
                variant="light"
                leftSection={<IconFilterOff size={16} />}
                onClick={onClearFilter}
              >
                {t('billList.clearFilter')}
              </Button>
            )}
          </Stack>
        </Card>
      );
    }

    return (
      <Card p="xl" withBorder>
        <Stack align="center" gap="md">
          <Text size="lg" c="dimmed">
            {t('billList.empty')}
          </Text>
          <Button leftSection={<IconPlus size={16} />} onClick={onAdd}>
            {t('billList.addEntry')}
          </Button>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" className="no-print">
        <Group gap="sm">
          <Select
            placeholder={t('billList.allTypes')}
            data={[
              { value: 'all', label: t('billList.allTransactions') },
              { value: 'expense', label: t('billList.expensesOnly') },
              { value: 'deposit', label: t('billList.depositsOnly') }
            ]}
            value={filter.type}
            onChange={(value) => onFilterChange({ ...filter, type: (value as 'all' | 'expense' | 'deposit') || 'all' })}
            clearable
            size="sm"
            w={180}
          />
          <Select
            placeholder={t('billList.allAccounts')}
            data={accounts}
            value={filter.account}
            onChange={(value) => onFilterChange({ ...filter, account: value })}
            clearable
            searchable
            size="sm"
            w={180}
          />
          <Select
            placeholder={t('billList.allCategories')}
            data={categories}
            value={filter.category}
            onChange={(value) => onFilterChange({ ...filter, category: value })}
            clearable
            searchable
            size="sm"
            w={180}
          />
        </Group>
        <Group gap="sm">
          {onSearchChange && (
            <TextInput
              placeholder={t('billList.searchPlaceholder')}
              leftSection={<IconSearch size={16} />}
              rightSection={
                searchQuery && (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={() => onSearchChange('')}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                )
              }
              value={searchQuery}
              onChange={(e) => onSearchChange(e.currentTarget.value)}
              size="sm"
              w={200}
            />
          )}
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="light" leftSection={<IconDownload size={16} />} size="sm">
                {t('billList.export')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t('billList.exportBills')}</Menu.Label>
              <Menu.Item
                leftSection={<IconFileTypeCsv size={16} />}
                onClick={() => {
                  exportBillsToCSV(bills, t);
                  window.umami?.track('export_bills', { format: 'csv' });
                }}
              >
                {t('billList.exportCsv')}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconFileTypePdf size={16} />}
                onClick={() => {
                  exportBillsToPDF(bills, t);
                  window.umami?.track('export_bills', { format: 'pdf' });
                }}
              >
                {t('billList.exportPdf')}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconPrinter size={16} />}
                onClick={() => {
                  printBills(bills, t);
                  window.umami?.track('print_bills');
                }}
              >
                {t('billList.print')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Button leftSection={<IconPlus size={16} />} onClick={onAdd} size="sm">
            {t('billList.addEntry')}
          </Button>
        </Group>
      </Group>

      {/* Active filter indicator */}
      {hasActiveFilter && (
        <Paper p="xs" px="md" withBorder radius="md" bg="var(--mantine-color-blue-light)" style={{ borderColor: 'var(--mantine-color-blue-3)' }}>
          <Group justify="space-between">
            <Group gap="xs">
              <IconFilter size={14} color="var(--mantine-color-blue-6)" />
              <Text size="sm" c="blue.7" fw={500}>
                {t('billList.filtered')}{' '}
                {filter.dateRange === 'overdue' && t('billList.filterOverdue')}
                {filter.dateRange === 'thisWeek' && t('billList.filterThisWeek')}
                {filter.dateRange === 'nextWeek' && t('billList.filterNextWeek')}
                {filter.dateRange === 'next21Days' && t('billList.filterNext21Days')}
                {filter.dateRange === 'next30Days' && t('billList.filterNext30Days')}
                {filter.selectedDate && t('billList.filterSelectedDate', { date: filter.selectedDate })}
                {filter.searchQuery && t('billList.filterSearch', { query: filter.searchQuery })}
                {filter.category && t('billList.filterCategory', { category: filter.category })}
                {filter.account && t('billList.filterAccount', { account: filter.account })}
                {filter.type !== 'all' && (filter.type === 'deposit' ? t('billList.filterDepositsOnly') : t('billList.filterExpensesOnly'))}
                {filter.dateRange === 'all' && !filter.selectedDate && !filter.searchQuery && !filter.category && !filter.account && filter.type === 'all' && t('billList.filterActive')}
              </Text>
              <Badge size="sm" variant="light" color="blue">{t('billList.results', { count: bills.length })}</Badge>
            </Group>
            {onClearFilter && (
              <Button
                variant="subtle"
                size="compact-xs"
                color="blue"
                leftSection={<IconFilterOff size={14} />}
                onClick={onClearFilter}
              >
                {t('billList.clear')}
              </Button>
            )}
          </Group>
        </Paper>
      )}

      <Paper withBorder>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('common.table.name')}</Table.Th>
              <Table.Th>{t('common.table.amount')}</Table.Th>
              <Table.Th>{t('common.table.dueDate')}</Table.Th>
              <Table.Th>{t('common.table.frequency')}</Table.Th>
              {isAllBucketsMode && <Table.Th>{t('billList.bucketColumn')}</Table.Th>}
              <Table.Th className="no-print">{t('common.table.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {paginatedBills.map((bill) => (
              <Table.Tr
                key={bill.id}
                style={{
                  cursor: 'pointer',
                  opacity: bill.archived ? 0.6 : 1,
                  backgroundColor: bill.archived
                    ? 'var(--mantine-color-gray-light)'
                    : undefined,
                }}
                onClick={() => onViewPayments(bill)}
              >
                <Table.Td>
                  <Group gap="sm">
                    <BillIcon icon={bill.icon} size={24} />
                    <div>
                      <Group gap={6} align="center">
                        <Text fw={500}>{bill.name}</Text>
                        {/* Sharing indicator icon - inline with bill name */}
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
                        {bill.category && (
                          <Badge size="xs" variant="light" color="grape">
                            {bill.category}
                          </Badge>
                        )}
                        {!!bill.archived && (
                          <Badge size="xs" color="gray" variant="filled">
                            {t('common.archived')}
                          </Badge>
                        )}
                        {!!bill.auto_payment && !bill.archived && (
                          <Badge size="xs" color="green" variant="light">
                            {t('common.autoPay')}
                          </Badge>
                        )}
                        {bill.reminder_enabled === false && !bill.archived && (
                          <Badge size="xs" color="gray" variant="light">
                            {t('billList.reminderOff')}
                          </Badge>
                        )}
                        {bill.is_shared && bill.share_info?.my_portion_paid && (
                          <Badge size="xs" color="green" variant="filled">
                            {t('billList.myPortionPaid')}
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
                    <>
                      <Text fw={500} c={bill.type === 'deposit' ? 'green' : 'red'}>
                        {formatCurrency(bill.amount || 0)}
                      </Text>
                      {bill.is_shared && bill.share_info?.my_portion !== null && bill.share_info?.my_portion !== undefined && (
                        <Text size="xs" c="dimmed">
                          {t('billList.myPortion', { amount: formatCurrency(bill.share_info.my_portion) })}
                        </Text>
                      )}
                    </>
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
                {isAllBucketsMode && (
                  <Table.Td>
                    <Badge size="sm" variant="outline" color="gray">
                      {bill.database_name || t('billList.unknownBucket')}
                    </Badge>
                  </Table.Td>
                )}
                <Table.Td className="no-print">
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
                    {bill.is_shared && bill.share_info && (
                      <ActionIcon
                        variant={bill.share_info.my_portion_paid ? 'light' : 'filled'}
                        color="green"
                        onClick={() => setConfirmPayBill(bill)}
                        title={bill.share_info.my_portion_paid ? t('common.markAsUnpaid') : t('common.markMyPortionPaid')}
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
      </Paper>

      {totalPages > 1 && (
        <Group justify="center">
          <Pagination
            total={totalPages}
            value={validPage}
            onChange={setCurrentPage}
            size="sm"
          />
        </Group>
      )}

      {/* Confirmation modal for shared bill payment */}
      <Modal
        opened={!!confirmPayBill}
        onClose={() => setConfirmPayBill(null)}
        title={confirmPayBill?.share_info?.my_portion_paid ? t('billList.markUnpaidTitle') : t('billList.confirmPaymentTitle')}
        centered
        size="sm"
      >
        {confirmPayBill && confirmPayBill.share_info && (
          <Stack gap="md">
            <Text>
              {confirmPayBill.share_info.my_portion_paid
                ? t('billList.confirmMarkUnpaid', { name: confirmPayBill.name })
                : t('billList.confirmMarkPaid', { name: confirmPayBill.name })}
            </Text>
            {!confirmPayBill.share_info.my_portion_paid && confirmPayBill.share_info.my_portion !== null && (
              <Paper p="md" withBorder bg="gray.0">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">{t('billList.yourPortion')}</Text>
                  <Text fw={600} size="lg">{formatCurrency(confirmPayBill.share_info.my_portion)}</Text>
                </Group>
              </Paper>
            )}
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setConfirmPayBill(null)}>
                {t('common.actions.cancel')}
              </Button>
              <Button
                color={confirmPayBill.share_info.my_portion_paid ? 'orange' : 'green'}
                onClick={() => handleMarkPaid(confirmPayBill)}
                loading={paymentLoading}
              >
                {confirmPayBill.share_info.my_portion_paid ? t('billList.markUnpaidButton') : t('billList.confirmPaidButton')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
