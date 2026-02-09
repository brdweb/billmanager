import { Paper, Title, Text, Group, Button, Table, Badge, ThemeIcon, ActionIcon, Tooltip } from '@mantine/core';
import { IconCalendar, IconCash, IconEdit, IconUsers } from '@tabler/icons-react';
import type { Bill } from '../../api/client';
import { BillIcon } from '../BillIcon';

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

function getFrequencyText(bill: Bill): string {
  let frequencyConfig: { dates?: number[]; days?: number[] } = {};
  try { frequencyConfig = bill.frequency_config ? JSON.parse(bill.frequency_config) : {}; } catch { /* ignore malformed config */ }

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

export function UpcomingBillsList({ bills, onPay, onEdit, onViewPayments, onViewAll }: UpcomingBillsListProps) {
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
          <Title order={5}>Upcoming Bills (Next 7 Days)</Title>
        </Group>
        <Button variant="subtle" size="xs" onClick={onViewAll}>
          View All
        </Button>
      </Group>

      {upcomingBills.length === 0 ? (
        <Text c="dimmed" ta="center" py="md">
          No bills due in the next 7 days
        </Text>
      ) : (
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
                                ? `Shared with you by ${bill.share_info?.owner_name}`
                                : `Shared with ${bill.share_count} ${bill.share_count === 1 ? 'person' : 'people'}`
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
                          {bill.type === 'deposit' ? 'Deposit' : 'Expense'}
                        </Badge>
                        {bill.is_shared && bill.share_info && (
                          <Badge size="xs" color="violet" variant="filled">
                            From {bill.share_info.owner_name}
                          </Badge>
                        )}
                        {bill.account && (
                          <Badge size="xs" variant="dot" color="cyan">
                            {bill.account}
                          </Badge>
                        )}
                        {!!bill.auto_payment && (
                          <Badge size="xs" color="green" variant="light">
                            Auto-pay
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
                    <Text fw={500} c={bill.type === 'deposit' ? 'green' : 'red'}>
                      ${(bill.amount || 0).toFixed(2)}
                    </Text>
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
                    {bill.is_shared && (
                      <ActionIcon
                        variant="filled"
                        color="green"
                        onClick={() => onPay(bill)}
                        title="Mark my portion as paid"
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
