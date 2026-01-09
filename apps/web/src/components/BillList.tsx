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
} from '@mantine/core';
import { IconEdit, IconCash, IconPlus, IconFilterOff, IconSearch, IconX, IconDownload, IconFileTypeCsv, IconFileTypePdf, IconCheck } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { exportBillsToCSV, exportBillsToPDF } from '../utils/export';
import type { Bill } from '../api/client';
import { getAccounts, markSharePaid } from '../api/client';
import { BillIcon } from './BillIcon';
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
}

function getFrequencyText(bill: Bill): string {
  const frequencyConfig = bill.frequency_config ? JSON.parse(bill.frequency_config) : {};

  switch (bill.frequency) {
    case 'weekly':
      return 'Weekly';
    case 'bi-weekly':
    case 'biweekly':
      return 'Bi-weekly';
    case 'quarterly':
      return 'Quarterly';
    case 'yearly':
      return 'Yearly';
    case 'monthly':
      if (bill.frequency_type === 'specific_dates' && frequencyConfig.dates) {
        const dates = frequencyConfig.dates.join(', ');
        return `Monthly (${dates}${frequencyConfig.dates.length === 1 ? 'st/nd/rd/th' : ''})`;
      }
      return 'Monthly';
    case 'custom':
      if (bill.frequency_type === 'multiple_weekly' && frequencyConfig.days) {
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const days = frequencyConfig.days.map((d: number) => dayNames[d]).join(', ');
        return `Weekly (${days})`;
      }
      return 'Custom';
    default:
      return bill.frequency;
  }
}

// Parse date string directly to avoid timezone issues
function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(dateStr: string): string {
  const date = parseDate(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
}: BillListProps) {
  // Accounts list for filtering
  const [accounts, setAccounts] = useState<string[]>([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 15;

  // Handler for marking shared bill portion as paid
  const handleMarkPaid = async (bill: Bill) => {
    if (!bill.is_shared || !bill.share_info) return;

    try {
      await markSharePaid(bill.share_info.share_id);
      notifications.show({
        title: 'Success',
        message: bill.share_info.my_portion_paid ? 'Marked as unpaid' : 'Marked as paid',
        color: 'green',
      });
      onRefresh?.();
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: 'Failed to update payment status',
        color: 'red',
      });
    }
  };

  // Fetch accounts list when logged in
  useEffect(() => {
    if (isLoggedIn) {
      getAccounts()
        .then((res) => setAccounts(res))
        .catch((err) => console.error('Failed to fetch accounts:', err));
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
            Please log in to view your bills
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
            No bill group access
          </Text>
          <Text size="sm" c="dimmed" ta="center">
            Your account does not have access to any bill groups.
            Please contact an administrator to grant you access.
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
              No bills match your current filter
            </Text>
            {onClearFilter && (
              <Button
                variant="light"
                leftSection={<IconFilterOff size={16} />}
                onClick={onClearFilter}
              >
                Clear Filter
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
            No bills yet. Add your first bill to get started!
          </Text>
          <Button leftSection={<IconPlus size={16} />} onClick={onAdd}>
            Add Entry
          </Button>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="sm">
          <Select
            placeholder="All types"
            data={[
              { value: 'all', label: 'All Transactions' },
              { value: 'expense', label: 'Expenses Only' },
              { value: 'deposit', label: 'Deposits Only' }
            ]}
            value={filter.type}
            onChange={(value) => onFilterChange({ ...filter, type: (value as 'all' | 'expense' | 'deposit') || 'all' })}
            clearable
            size="sm"
            w={180}
          />
          <Select
            placeholder="All accounts"
            data={accounts}
            value={filter.account}
            onChange={(value) => onFilterChange({ ...filter, account: value })}
            clearable
            searchable
            size="sm"
            w={180}
          />
        </Group>
        <Group gap="sm">
          {onSearchChange && (
            <TextInput
              placeholder="Search..."
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
                Export
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Export bills</Menu.Label>
              <Menu.Item
                leftSection={<IconFileTypeCsv size={16} />}
                onClick={() => {
                  exportBillsToCSV(bills);
                  window.umami?.track('export_bills', { format: 'csv' });
                }}
              >
                Export as CSV
              </Menu.Item>
              <Menu.Item
                leftSection={<IconFileTypePdf size={16} />}
                onClick={() => {
                  exportBillsToPDF(bills);
                  window.umami?.track('export_bills', { format: 'pdf' });
                }}
              >
                Export as PDF
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Button leftSection={<IconPlus size={16} />} onClick={onAdd} size="sm">
            Add Entry
          </Button>
        </Group>
      </Group>

      <Paper withBorder>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Amount</Table.Th>
              <Table.Th>Due Date</Table.Th>
              <Table.Th>Frequency</Table.Th>
              <Table.Th>Actions</Table.Th>
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
                    : bill.is_shared
                    ? 'var(--mantine-color-blue-0)'
                    : undefined,
                  borderLeft: bill.is_shared ? '3px solid var(--mantine-color-blue-6)' : undefined,
                }}
                onClick={() => onViewPayments(bill)}
              >
                <Table.Td>
                  <Group gap="sm">
                    <BillIcon icon={bill.icon} size={24} />
                    <div>
                      <Text fw={500}>{bill.name}</Text>
                      <Group gap={4}>
                        <Badge
                          size="xs"
                          color={bill.type === 'deposit' ? 'green' : 'blue'}
                          variant="light"
                        >
                          {bill.type === 'deposit' ? 'Deposit' : 'Expense'}
                        </Badge>
                        {bill.is_shared && bill.share_info && (
                          <Badge size="xs" color="violet" variant="filled">
                            Shared by {bill.share_info.owner_name}
                          </Badge>
                        )}
                        {bill.account && (
                          <Badge size="xs" variant="dot" color="cyan">
                            {bill.account}
                          </Badge>
                        )}
                        {!!bill.archived && (
                          <Badge size="xs" color="gray" variant="filled">
                            Archived
                          </Badge>
                        )}
                        {!!bill.auto_payment && !bill.archived && (
                          <Badge size="xs" color="green" variant="light">
                            Auto-pay
                          </Badge>
                        )}
                        {bill.is_shared && bill.share_info?.my_portion_paid && (
                          <Badge size="xs" color="green" variant="filled">
                            My portion paid
                          </Badge>
                        )}
                      </Group>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td>
                  {bill.varies ? (
                    <Text c={bill.type === 'deposit' ? 'green' : 'red'}>
                      Varies{' '}
                      <Text span size="xs">
                        (~${(bill.avg_amount || 0).toFixed(2)})
                      </Text>
                    </Text>
                  ) : (
                    <>
                      <Text fw={500} c={bill.type === 'deposit' ? 'green' : 'red'}>
                        ${(bill.amount || 0).toFixed(2)}
                      </Text>
                      {bill.is_shared && bill.share_info?.my_portion !== null && bill.share_info?.my_portion !== undefined && (
                        <Text size="xs" c="dimmed">
                          My portion: ${bill.share_info.my_portion.toFixed(2)}
                        </Text>
                      )}
                    </>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge color={getDueBadgeColor(bill.next_due)} variant="light">
                    {formatDate(bill.next_due)}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {getFrequencyText(bill)}
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
                          title="Edit"
                        >
                          <IconEdit size={18} />
                        </ActionIcon>
                        <ActionIcon
                          variant="filled"
                          color="green"
                          onClick={() => onPay(bill)}
                          title="Pay"
                        >
                          <IconCash size={18} />
                        </ActionIcon>
                      </>
                    )}
                    {bill.is_shared && bill.share_info && (
                      <ActionIcon
                        variant={bill.share_info.my_portion_paid ? 'filled' : 'outline'}
                        color="green"
                        onClick={() => handleMarkPaid(bill)}
                        title={bill.share_info.my_portion_paid ? 'Mark as unpaid' : 'Mark my portion as paid'}
                      >
                        <IconCheck size={18} />
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
    </Stack>
  );
}
