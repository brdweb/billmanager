import { Modal, Stack, Text, Paper, Group, Button, Badge, Box } from '@mantine/core';
import { IconCoin, IconCoinOff } from '@tabler/icons-react';
import type { Bill } from '../api/client';

interface DayDetailModalProps {
  opened: boolean;
  onClose: () => void;
  date: string | null;
  bills: Bill[];
  onPay: (bill: Bill) => void;
  onEdit: (bill: Bill) => void;
}

export function DayDetailModal({ opened, onClose, date, bills, onPay, onEdit }: DayDetailModalProps) {
  if (!date) return null;

  // Parse date for display
  const [year, month, day] = date.split('-').map(Number);
  const dateObj = new Date(year, month - 1, day);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Filter bills for this date
  const dayBills = bills.filter((b) => !b.archived && b.next_due === date);

  // Separate expenses and deposits
  const expenses = dayBills.filter((b) => b.type === 'expense');
  const deposits = dayBills.filter((b) => b.type === 'deposit');

  // Calculate totals
  const expenseTotal = expenses.reduce((sum, b) => sum + (b.varies ? (b.avg_amount || 0) : (b.amount || 0)), 0);
  const depositTotal = deposits.reduce((sum, b) => sum + (b.varies ? (b.avg_amount || 0) : (b.amount || 0)), 0);

  return (
    <Modal opened={opened} onClose={onClose} title={formattedDate} size="md">
      <Stack gap="md">
        {dayBills.length === 0 ? (
          <Text c="dimmed" ta="center" py="lg">
            No bills due on this date
          </Text>
        ) : (
          <>
            {/* Summary */}
            <Group grow>
              {expenses.length > 0 && (
                <Paper withBorder p="xs" radius="sm" bg="red.0">
                  <Text size="xs" c="red.7" fw={500}>Expenses</Text>
                  <Text fw={700} c="red.8">${expenseTotal.toFixed(2)}</Text>
                </Paper>
              )}
              {deposits.length > 0 && (
                <Paper withBorder p="xs" radius="sm" bg="green.0">
                  <Text size="xs" c="green.7" fw={500}>Deposits</Text>
                  <Text fw={700} c="green.8">${depositTotal.toFixed(2)}</Text>
                </Paper>
              )}
            </Group>

            {/* Bills list */}
            <Stack gap="xs">
              {dayBills.map((bill) => {
                const amount = bill.varies ? (bill.avg_amount || 0) : (bill.amount || 0);
                const isExpense = bill.type === 'expense';

                return (
                  <Paper key={bill.id} withBorder p="sm" radius="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                          <Text fw={500} truncate style={{ maxWidth: 180 }}>
                            {bill.name}
                          </Text>
                          <Badge
                            size="xs"
                            color={isExpense ? 'red' : 'green'}
                            variant="light"
                          >
                            {isExpense ? 'Expense' : 'Deposit'}
                          </Badge>
                          {bill.varies && (
                            <Badge size="xs" color="gray" variant="outline">
                              ~avg
                            </Badge>
                          )}
                        </Group>
                        <Text size="sm" c="dimmed">
                          ${amount.toFixed(2)}
                          {bill.account && ` - ${bill.account}`}
                        </Text>
                      </Box>
                      <Group gap="xs">
                        <Button
                          variant="light"
                          size="xs"
                          color={isExpense ? 'green' : 'blue'}
                          leftSection={isExpense ? <IconCoin size={14} /> : <IconCoinOff size={14} />}
                          onClick={() => {
                            onPay(bill);
                            onClose();
                          }}
                        >
                          {isExpense ? 'Pay' : 'Record'}
                        </Button>
                        <Button
                          variant="subtle"
                          size="xs"
                          color="gray"
                          onClick={() => {
                            onEdit(bill);
                            onClose();
                          }}
                        >
                          Edit
                        </Button>
                      </Group>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          </>
        )}
      </Stack>
    </Modal>
  );
}
