import { useState, useEffect, useMemo } from 'react';
import '@mantine/charts/styles.css';
import {
  Stack,
  Title,
  TextInput,
  Group,
  Select,
  Table,
  Text,
  Paper,
  Loader,
  Center,
  NumberInput,
  Badge,
  ActionIcon,
  Button,
  Collapse,
  Menu,
  Pagination,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { BarChart } from '@mantine/charts';
import { IconSearch, IconX, IconArrowLeft, IconChartBar, IconChevronDown, IconChevronUp, IconDownload, IconFileTypeCsv, IconFileTypePdf, IconPrinter, IconArrowUpRight, IconArrowDownRight, IconFilter, IconFilterOff } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { getAllPayments, updatePayment, deletePayment } from '../api/client';
import type { PaymentWithBill } from '../api/client';
import { BillIcon } from '../components/BillIcon';
import { IconEdit, IconTrash, IconCheck } from '@tabler/icons-react';
import { exportPaymentsToCSV, exportPaymentsToPDF, printPayments } from '../utils/export';
import { parseLocalDate, formatDateString, formatDateForAPI } from '../utils/date';
import {
  formatCurrency,
  formatCurrencyAxis,
  getCurrencyInputProps,
  getLocale,
} from '../lib/currency';

interface MonthlyChartData {
  month: string;
  label: string;
  total: number;
}

export function AllPayments() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [payments, setPayments] = useState<PaymentWithBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartOpened, { toggle: toggleChart }] = useDisclosure(true);

  // Filter states - default to past 30 days
  const [searchName, setSearchName] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | null>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [amountMin, setAmountMin] = useState<number | ''>('');
  const [amountMax, setAmountMax] = useState<number | ''>('');
  const [sortBy, setSortBy] = useState<string | null>('date_desc');

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState<number | ''>('');
  const [editDate, setEditDate] = useState<Date | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  useEffect(() => {
    fetchPayments();
  }, []);

  const fetchPayments = async () => {
    setLoading(true);
    try {
      const response = await getAllPayments();
      setPayments(Array.isArray(response) ? response : []);
    } catch (error) {
      console.error('Failed to fetch payments:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filtered and sorted payments
  const filteredPayments = useMemo(() => {
    let result = [...payments];

    // Filter by name
    if (searchName.trim()) {
      const query = searchName.toLowerCase();
      result = result.filter((p) => p.bill_name.toLowerCase().includes(query));
    }

    // Filter by date range
    if (dateFrom) {
      result = result.filter((p) => {
        const date = parseLocalDate(p.payment_date);
        return date && date >= dateFrom;
      });
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      result = result.filter((p) => {
        const date = parseLocalDate(p.payment_date);
        return date && date <= endDate;
      });
    }

    // Filter by amount range
    if (amountMin !== '') {
      result = result.filter((p) => p.amount >= amountMin);
    }
    if (amountMax !== '') {
      result = result.filter((p) => p.amount <= amountMax);
    }

    // Sort
    switch (sortBy) {
      case 'date_desc':
        result.sort((a, b) => {
          const dateA = parseLocalDate(a.payment_date);
          const dateB = parseLocalDate(b.payment_date);
          if (!dateA || !dateB) return 0;
          return dateB.getTime() - dateA.getTime();
        });
        break;
      case 'date_asc':
        result.sort((a, b) => {
          const dateA = parseLocalDate(a.payment_date);
          const dateB = parseLocalDate(b.payment_date);
          if (!dateA || !dateB) return 0;
          return dateA.getTime() - dateB.getTime();
        });
        break;
      case 'amount_desc':
        result.sort((a, b) => b.amount - a.amount);
        break;
      case 'amount_asc':
        result.sort((a, b) => a.amount - b.amount);
        break;
      case 'name_asc':
        result.sort((a, b) => a.bill_name.localeCompare(b.bill_name));
        break;
      case 'name_desc':
        result.sort((a, b) => b.bill_name.localeCompare(a.bill_name));
        break;
    }

    return result;
  }, [payments, searchName, dateFrom, dateTo, amountMin, amountMax, sortBy]);

  // Paginated payments - reset to page 1 if current page is out of bounds
  const totalPages = Math.ceil(filteredPayments.length / ITEMS_PER_PAGE);
  const validPage = currentPage > totalPages ? 1 : currentPage;
  const paginatedPayments = useMemo(() => {
    const page = currentPage > Math.ceil(filteredPayments.length / ITEMS_PER_PAGE) ? 1 : currentPage;
    const start = (page - 1) * ITEMS_PER_PAGE;
    return filteredPayments.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredPayments, currentPage]);

  const clearFilters = () => {
    setSearchName('');
    setDateFrom(null);
    setDateTo(null);
    setAmountMin('');
    setAmountMax('');
    setSortBy('date_desc');
  };

  const hasActiveFilters =
    searchName !== '' ||
    dateFrom !== null ||
    dateTo !== null ||
    amountMin !== '' ||
    amountMax !== '';


  const handleEdit = (payment: PaymentWithBill) => {
    setEditingId(payment.id);
    setEditAmount(payment.amount);
    setEditDate(parseLocalDate(payment.payment_date));
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditAmount('');
    setEditDate(null);
  };

  const handleSaveEdit = async () => {
    if (editingId === null || editAmount === '' || !editDate) return;

    try {
      await updatePayment(editingId, editAmount as number, formatDateForAPI(editDate));
      notifications.show({ message: t('allPaymentsPage.updateSuccess'), color: 'green', autoClose: 3000 });
      await fetchPayments();
      handleCancelEdit();
    } catch (error) {
      console.error('Failed to update payment:', error);
      notifications.show({ title: t('allPaymentsPage.updateFailedTitle'), message: String(error), color: 'red', autoClose: 5000 });
    }
  };

  const handleDelete = async (paymentId: number) => {
    if (!confirm(t('paymentHistory.confirmDelete'))) return;

    try {
      await deletePayment(paymentId);
      notifications.show({ message: t('allPaymentsPage.deleteSuccess'), color: 'green', autoClose: 3000 });
      setPayments((prev) => prev.filter((p) => p.id !== paymentId));
    } catch (error) {
      console.error('Failed to delete payment:', error);
      notifications.show({ title: t('allPaymentsPage.deleteFailedTitle'), message: String(error), color: 'red', autoClose: 5000 });
    }
  };

  // Calculate totals
  const totalAmount = filteredPayments.reduce((sum, p) => sum + p.amount, 0);

  // Calculate monthly chart data from filtered payments
  const monthlyChartData = useMemo((): MonthlyChartData[] => {
    const monthlyTotals: Record<string, number> = {};

    filteredPayments.forEach((p) => {
      const date = parseLocalDate(p.payment_date);
      if (!date) return; // Skip invalid dates
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyTotals[key] = (monthlyTotals[key] || 0) + p.amount;
    });

    // Sort by date and convert to chart format
    return Object.entries(monthlyTotals)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12) // Last 12 months
      .map(([month, total]) => {
        const [year, m] = month.split('-');
        const date = new Date(parseInt(year), parseInt(m) - 1, 1);
        return {
          month,
          label: date.toLocaleDateString(getLocale(), { month: 'short', year: '2-digit' }),
          total,
        };
      });
  }, [filteredPayments]);

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Group>
          <ActionIcon variant="subtle" size="lg" onClick={() => navigate('/')}>
            <IconArrowLeft size={20} />
          </ActionIcon>
          <Title order={2}>{t('allPaymentsPage.title')}</Title>
        </Group>
        <Group gap="sm">
          <Badge size="lg" variant="light">
            {t('allPaymentsPage.summaryBadge', { count: filteredPayments.length, amount: formatCurrency(totalAmount) })}
          </Badge>
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="light" leftSection={<IconDownload size={16} />} size="sm">
                {t('billList.export')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t('allPaymentsPage.exportPayments')}</Menu.Label>
              <Menu.Item
                leftSection={<IconFileTypeCsv size={16} />}
                onClick={() => exportPaymentsToCSV(filteredPayments, t, { from: dateFrom || undefined, to: dateTo || undefined })}
              >
                {t('billList.exportCsv')}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconFileTypePdf size={16} />}
                onClick={() => exportPaymentsToPDF(filteredPayments, t, { from: dateFrom || undefined, to: dateTo || undefined })}
              >
                {t('billList.exportPdf')}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconPrinter size={16} />}
                onClick={() => {
                  printPayments(filteredPayments, t, { from: dateFrom || undefined, to: dateTo || undefined });
                  window.umami?.track('print_payments');
                }}
              >
                {t('billList.print')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {/* Filters */}
      <Paper p="md" withBorder className="no-print">
        <Stack gap="sm">
          <Group grow>
            <TextInput
              placeholder={t('allPaymentsPage.searchPlaceholder')}
              leftSection={<IconSearch size={16} />}
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              rightSection={
                searchName && (
                  <ActionIcon variant="subtle" onClick={() => setSearchName('')}>
                    <IconX size={14} />
                  </ActionIcon>
                )
              }
            />
            <Select
              placeholder={t('allPaymentsPage.sortByPlaceholder')}
              value={sortBy}
              onChange={setSortBy}
              data={[
                { value: 'date_desc', label: t('allPaymentsPage.sortDateDesc') },
                { value: 'date_asc', label: t('allPaymentsPage.sortDateAsc') },
                { value: 'amount_desc', label: t('allPaymentsPage.sortAmountDesc') },
                { value: 'amount_asc', label: t('allPaymentsPage.sortAmountAsc') },
                { value: 'name_asc', label: t('allPaymentsPage.sortNameAsc') },
                { value: 'name_desc', label: t('allPaymentsPage.sortNameDesc') },
              ]}
            />
          </Group>

          <Group grow>
            <DatePickerInput
              placeholder={t('allPaymentsPage.fromDatePlaceholder')}
              value={dateFrom}
              onChange={(val) => setDateFrom(val ? parseLocalDate(val) : null)}
              valueFormat={t('common.dateInputFormat')}
              clearable
            />
            <DatePickerInput
              placeholder={t('allPaymentsPage.toDatePlaceholder')}
              value={dateTo}
              onChange={(val) => setDateTo(val ? parseLocalDate(val) : null)}
              valueFormat={t('common.dateInputFormat')}
              clearable
            />
            <NumberInput
              placeholder={t('allPaymentsPage.minAmountPlaceholder')}
              {...getCurrencyInputProps()}
              value={amountMin}
              onChange={(val) => setAmountMin(val === '' ? '' : Number(val))}
              min={0}
            />
            <NumberInput
              placeholder={t('allPaymentsPage.maxAmountPlaceholder')}
              {...getCurrencyInputProps()}
              value={amountMax}
              onChange={(val) => setAmountMax(val === '' ? '' : Number(val))}
              min={0}
            />
          </Group>
        </Stack>
      </Paper>

      {/* Active filter indicator */}
      {hasActiveFilters && (
        <Paper p="xs" px="md" withBorder radius="md" bg="var(--mantine-color-blue-light)" style={{ borderColor: 'var(--mantine-color-blue-3)' }}>
          <Group justify="space-between">
            <Group gap="xs">
              <IconFilter size={14} color="var(--mantine-color-blue-6)" />
              <Text size="sm" c="blue.7" fw={500}>
                {t('billList.filtered')}{' '}
                {[
                  searchName && t('allPaymentsPage.filterQuoted', { query: searchName }),
                  dateFrom && t('allPaymentsPage.filterFrom', { date: formatDateString(formatDateForAPI(dateFrom)) }),
                  dateTo && t('allPaymentsPage.filterTo', { date: formatDateString(formatDateForAPI(dateTo)) }),
                  amountMin !== '' && t('allPaymentsPage.filterMin', { amount: formatCurrency(Number(amountMin)) }),
                  amountMax !== '' && t('allPaymentsPage.filterMax', { amount: formatCurrency(Number(amountMax)) }),
                ].filter(Boolean).join(', ')}
              </Text>
              <Badge size="sm" variant="light" color="blue">
                {t('billList.results', { count: filteredPayments.length })}
              </Badge>
            </Group>
            <Button
              variant="subtle"
              size="compact-xs"
              color="blue"
              leftSection={<IconFilterOff size={14} />}
              onClick={clearFilters}
            >
              {t('billList.clear')}
            </Button>
          </Group>
        </Paper>
      )}

      {/* Monthly Chart */}
      {monthlyChartData.length > 0 && (
        <Paper p="md" withBorder>
          <Group justify="space-between" mb={chartOpened ? 'md' : 0}>
            <Group gap="xs">
              <IconChartBar size={18} />
              <Text fw={500} size="sm">
                {t('allPaymentsPage.monthlyTotals')} {hasActiveFilters && t('allPaymentsPage.filteredSuffix')}
              </Text>
            </Group>
            <Button
              variant="subtle"
              size="xs"
              onClick={toggleChart}
              rightSection={chartOpened ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            >
              {chartOpened ? t('allPaymentsPage.hide') : t('allPaymentsPage.show')}
            </Button>
          </Group>
          <Collapse expanded={chartOpened}>
            <BarChart
              h={200}
              data={monthlyChartData}
              dataKey="label"
              series={[{ name: 'total', color: 'violet.6', label: t('monthlyTotalsChart.totalPaidSeries') }]}
              withTooltip
              tooltipProps={{
                content: ({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  const item = payload[0].payload as MonthlyChartData;
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
          </Collapse>
        </Paper>
      )}

      {/* Payments Table */}
      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : filteredPayments.length === 0 ? (
        <Paper p="xl" withBorder>
          <Text ta="center" c="dimmed">
            {hasActiveFilters ? t('allPaymentsPage.noMatchFilters') : t('paymentHistory.noPayments')}
          </Text>
        </Paper>
      ) : (
        <Paper withBorder>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('dashboard.cashFlowForecast.columns.bill')}</Table.Th>
                <Table.Th>{t('common.table.type')}</Table.Th>
                <Table.Th>{t('common.table.date')}</Table.Th>
                <Table.Th>{t('common.table.amount')}</Table.Th>
                <Table.Th className="no-print">{t('common.table.actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {paginatedPayments.map((payment) => {
                const isDeposit = payment.bill_type === 'deposit';
                const isReceivedPayment = payment.is_received_payment === true;
                const canEdit = !isReceivedPayment;

                return (
                  <Table.Tr key={payment.id}>
                    <Table.Td>
                      <Group gap="xs">
                        <BillIcon icon={payment.bill_icon} size={20} />
                        <Stack gap={0}>
                          <Text>{payment.bill_name}</Text>
                          {payment.notes && (
                            <Text size="xs" c="dimmed">{payment.notes}</Text>
                          )}
                        </Stack>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="sm"
                        variant="light"
                        color={isDeposit ? 'green' : 'red'}
                        leftSection={isDeposit ? <IconArrowDownRight size={12} /> : <IconArrowUpRight size={12} />}
                      >
                        {isDeposit ? t('allPaymentsPage.income') : t('common.billType.expense')}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {editingId === payment.id ? (
                        <DatePickerInput
                          value={editDate}
                          onChange={(val) => setEditDate(val ? parseLocalDate(val) : null)}
                          valueFormat={t('common.dateInputFormat')}
                          size="xs"
                          w={140}
                        />
                      ) : (
                        formatDateString(payment.payment_date)
                      )}
                    </Table.Td>
                    <Table.Td>
                      {editingId === payment.id ? (
                        <NumberInput
                          value={editAmount}
                          onChange={(val) => setEditAmount(val === '' ? '' : Number(val))}
                          {...getCurrencyInputProps()}
                          fixedDecimalScale
                          size="xs"
                          w={100}
                        />
                      ) : (
                        <Text fw={500} c={isDeposit ? 'green' : undefined}>
                          {isDeposit ? '+' : ''}{formatCurrency(payment.amount)}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td className="no-print">
                      {editingId === payment.id ? (
                        <Group gap="xs">
                          <ActionIcon color="green" variant="subtle" onClick={handleSaveEdit} title={t('common.actions.save')}>
                            <IconCheck size={18} />
                          </ActionIcon>
                          <ActionIcon color="gray" variant="subtle" onClick={handleCancelEdit} title={t('common.actions.cancel')}>
                            <IconX size={18} />
                          </ActionIcon>
                        </Group>
                      ) : canEdit ? (
                        <Group gap="xs">
                          <ActionIcon
                            color="blue"
                            variant="subtle"
                            onClick={() => handleEdit(payment)}
                            title={t('common.actions.edit')}
                          >
                            <IconEdit size={18} />
                          </ActionIcon>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => handleDelete(payment.id)}
                            title={t('common.actions.delete')}
                          >
                            <IconTrash size={18} />
                          </ActionIcon>
                        </Group>
                      ) : (
                        <Text size="xs" c="dimmed">{t('allPaymentsPage.viewOnly')}</Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>

          {totalPages > 1 && (
            <Group justify="center" p="md">
              <Pagination
                total={totalPages}
                value={validPage}
                onChange={setCurrentPage}
                size="sm"
              />
            </Group>
          )}
        </Paper>
      )}
    </Stack>
  );
}
