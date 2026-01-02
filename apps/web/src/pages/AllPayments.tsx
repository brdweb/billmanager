import { useState, useEffect, useMemo } from 'react';
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
import { IconSearch, IconX, IconArrowLeft, IconChartBar, IconChevronDown, IconChevronUp, IconDownload, IconFileTypeCsv, IconFileTypePdf } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { getAllPayments, updatePayment, deletePayment } from '../api/client';
import type { PaymentWithBill } from '../api/client';
import { BillIcon } from '../components/BillIcon';
import { IconEdit, IconTrash, IconCheck } from '@tabler/icons-react';
import { exportPaymentsToCSV, exportPaymentsToPDF } from '../utils/export';
import { parseLocalDate, formatDateString, formatDateForAPI } from '../utils/date';

interface MonthlyChartData {
  month: string;
  label: string;
  total: number;
}

export function AllPayments() {
  const navigate = useNavigate();
  const [payments, setPayments] = useState<PaymentWithBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartOpened, { toggle: toggleChart }] = useDisclosure(true);

  // Filter states
  const [searchName, setSearchName] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
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
      setPayments(response);
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
      result = result.filter((p) => parseLocalDate(p.payment_date) >= dateFrom);
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      result = result.filter((p) => parseLocalDate(p.payment_date) <= endDate);
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
        result.sort((a, b) => parseLocalDate(b.payment_date).getTime() - parseLocalDate(a.payment_date).getTime());
        break;
      case 'date_asc':
        result.sort((a, b) => parseLocalDate(a.payment_date).getTime() - parseLocalDate(b.payment_date).getTime());
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

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchName, dateFrom, dateTo, amountMin, amountMax, sortBy]);

  // Paginated payments
  const totalPages = Math.ceil(filteredPayments.length / ITEMS_PER_PAGE);
  const paginatedPayments = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
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
      await fetchPayments();
      handleCancelEdit();
    } catch (error) {
      console.error('Failed to update payment:', error);
    }
  };

  const handleDelete = async (paymentId: number) => {
    if (!confirm('Are you sure you want to delete this payment?')) return;

    try {
      await deletePayment(paymentId);
      await fetchPayments();
    } catch (error) {
      console.error('Failed to delete payment:', error);
    }
  };

  // Calculate totals
  const totalAmount = filteredPayments.reduce((sum, p) => sum + p.amount, 0);

  // Calculate monthly chart data from filtered payments
  const monthlyChartData = useMemo((): MonthlyChartData[] => {
    const monthlyTotals: Record<string, number> = {};

    filteredPayments.forEach((p) => {
      const date = parseLocalDate(p.payment_date);
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
          label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
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
          <Title order={2}>All Payments</Title>
        </Group>
        <Group gap="sm">
          <Badge size="lg" variant="light">
            {filteredPayments.length} payments · ${totalAmount.toFixed(2)} total
          </Badge>
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="light" leftSection={<IconDownload size={16} />} size="sm">
                Export
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Export payments</Menu.Label>
              <Menu.Item
                leftSection={<IconFileTypeCsv size={16} />}
                onClick={() => exportPaymentsToCSV(filteredPayments, { from: dateFrom || undefined, to: dateTo || undefined })}
              >
                Export as CSV
              </Menu.Item>
              <Menu.Item
                leftSection={<IconFileTypePdf size={16} />}
                onClick={() => exportPaymentsToPDF(filteredPayments, { from: dateFrom || undefined, to: dateTo || undefined })}
              >
                Export as PDF
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {/* Filters */}
      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Group grow>
            <TextInput
              placeholder="Search by bill name..."
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
              placeholder="Sort by"
              value={sortBy}
              onChange={setSortBy}
              data={[
                { value: 'date_desc', label: 'Date (newest first)' },
                { value: 'date_asc', label: 'Date (oldest first)' },
                { value: 'amount_desc', label: 'Amount (high to low)' },
                { value: 'amount_asc', label: 'Amount (low to high)' },
                { value: 'name_asc', label: 'Bill name (A-Z)' },
                { value: 'name_desc', label: 'Bill name (Z-A)' },
              ]}
            />
          </Group>

          <Group grow>
            <DatePickerInput
              placeholder="From date"
              value={dateFrom}
              onChange={(value) => setDateFrom(value ? new Date(value) : null)}
              clearable
            />
            <DatePickerInput
              placeholder="To date"
              value={dateTo}
              onChange={(value) => setDateTo(value ? new Date(value) : null)}
              clearable
            />
            <NumberInput
              placeholder="Min amount"
              prefix="$"
              value={amountMin}
              onChange={(val) => setAmountMin(val === '' ? '' : Number(val))}
              decimalScale={2}
              min={0}
            />
            <NumberInput
              placeholder="Max amount"
              prefix="$"
              value={amountMax}
              onChange={(val) => setAmountMax(val === '' ? '' : Number(val))}
              decimalScale={2}
              min={0}
            />
          </Group>

          {hasActiveFilters && (
            <Group justify="flex-end">
              <Button variant="subtle" size="xs" leftSection={<IconX size={14} />} onClick={clearFilters}>
                Clear filters
              </Button>
            </Group>
          )}
        </Stack>
      </Paper>

      {/* Monthly Chart */}
      {monthlyChartData.length > 0 && (
        <Paper p="md" withBorder>
          <Group justify="space-between" mb={chartOpened ? 'md' : 0}>
            <Group gap="xs">
              <IconChartBar size={18} />
              <Text fw={500} size="sm">
                Monthly Totals {hasActiveFilters && '(Filtered)'}
              </Text>
            </Group>
            <Button
              variant="subtle"
              size="xs"
              onClick={toggleChart}
              rightSection={chartOpened ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            >
              {chartOpened ? 'Hide' : 'Show'}
            </Button>
          </Group>
          <Collapse in={chartOpened}>
            <BarChart
              h={200}
              data={monthlyChartData}
              dataKey="label"
              series={[{ name: 'total', color: 'violet.6', label: 'Total Paid' }]}
              withTooltip
              tooltipProps={{
                content: ({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  const item = payload[0].payload as MonthlyChartData;
                  return (
                    <Paper px="md" py="sm" withBorder shadow="md" radius="md">
                      <Text fw={500}>{item.label}</Text>
                      <Text c="dimmed" size="sm">
                        ${item.total.toFixed(2)}
                      </Text>
                    </Paper>
                  );
                },
              }}
              yAxisProps={{
                tickFormatter: (value: number) => `$${value}`,
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
            {hasActiveFilters ? 'No payments match your filters' : 'No payments recorded yet'}
          </Text>
        </Paper>
      ) : (
        <Paper withBorder>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Bill</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {paginatedPayments.map((payment) => (
                <Table.Tr key={payment.id}>
                  <Table.Td>
                    <Group gap="xs">
                      <BillIcon icon={payment.bill_icon} size={20} />
                      <Text>{payment.bill_name}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {editingId === payment.id ? (
                      <DatePickerInput
                        value={editDate}
                        onChange={(value) => setEditDate(value ? new Date(value) : null)}
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
                        prefix="$"
                        decimalScale={2}
                        fixedDecimalScale
                        size="xs"
                        w={100}
                      />
                    ) : (
                      <Text fw={500}>${payment.amount.toFixed(2)}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {editingId === payment.id ? (
                      <Group gap="xs">
                        <ActionIcon color="green" variant="subtle" onClick={handleSaveEdit} title="Save">
                          <IconCheck size={18} />
                        </ActionIcon>
                        <ActionIcon color="gray" variant="subtle" onClick={handleCancelEdit} title="Cancel">
                          <IconX size={18} />
                        </ActionIcon>
                      </Group>
                    ) : (
                      <Group gap="xs">
                        <ActionIcon
                          color="blue"
                          variant="subtle"
                          onClick={() => handleEdit(payment)}
                          title="Edit"
                        >
                          <IconEdit size={18} />
                        </ActionIcon>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={() => handleDelete(payment.id)}
                          title="Delete"
                        >
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          {totalPages > 1 && (
            <Group justify="center" p="md">
              <Pagination
                total={totalPages}
                value={currentPage}
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
