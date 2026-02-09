import { Paper, Text, Group, SimpleGrid, ThemeIcon, Stack } from '@mantine/core';
import { IconReceipt, IconCalendar, IconAlertTriangle, IconCoin } from '@tabler/icons-react';
import type { Bill } from '../../api/client';

interface StatCardsProps {
  bills: Bill[];
  monthlyPaid: number;
  onStatClick: (stat: 'total' | 'thisWeek' | 'overdue') => void;
}

export function StatCards({ bills, monthlyPaid, onStatClick }: StatCardsProps) {
  // Get today's date at midnight for comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parse date string to Date object
  const parseDate = (dateStr: string): Date => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // Filter active (non-archived) expense bills
  const activeBills = bills.filter((b) => !b.archived && b.type === 'expense');

  // Calculate stats
  const totalBills = activeBills.length;

  // Due this week (next 7 days)
  const oneDay = 24 * 60 * 60 * 1000;
  const weekFromNow = new Date(today.getTime() + 7 * oneDay);
  const dueThisWeek = activeBills.filter((b) => {
    const due = parseDate(b.next_due);
    return due >= today && due < weekFromNow;
  }).length;

  // Overdue bills
  const overdue = activeBills.filter((b) => {
    const due = parseDate(b.next_due);
    return due < today;
  }).length;

  // Monthly total (remaining to pay)
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const monthlyRemaining = activeBills
    .filter((b) => {
      const due = parseDate(b.next_due);
      return due.getMonth() === currentMonth && due.getFullYear() === currentYear;
    })
    .reduce((sum, b) => sum + (b.varies ? (b.avg_amount || 0) : (b.amount || 0)), 0);

  const monthlyTotal = monthlyPaid + monthlyRemaining;

  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
      <Paper withBorder p="md" radius="md" style={{ cursor: 'pointer' }} onClick={() => onStatClick('total')}>
        <Group justify="space-between">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Total Bills
            </Text>
            <Text fw={700} size="xl">
              {totalBills}
            </Text>
          </div>
          <ThemeIcon color="blue" variant="light" size="lg" radius="md">
            <IconReceipt size={20} />
          </ThemeIcon>
        </Group>
      </Paper>

      <Paper withBorder p="md" radius="md" style={{ cursor: 'pointer' }} onClick={() => onStatClick('thisWeek')}>
        <Group justify="space-between">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Due This Week
            </Text>
            <Text fw={700} size="xl">
              {dueThisWeek}
            </Text>
          </div>
          <ThemeIcon color="orange" variant="light" size="lg" radius="md">
            <IconCalendar size={20} />
          </ThemeIcon>
        </Group>
      </Paper>

      <Paper withBorder p="md" radius="md" style={{ cursor: 'pointer' }} onClick={() => onStatClick('overdue')}>
        <Group justify="space-between">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Overdue
            </Text>
            <Text fw={700} size="xl" c={overdue > 0 ? 'red' : undefined}>
              {overdue}
            </Text>
          </div>
          <ThemeIcon color={overdue > 0 ? 'red' : 'gray'} variant="light" size="lg" radius="md">
            <IconAlertTriangle size={20} />
          </ThemeIcon>
        </Group>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Monthly Total
            </Text>
            <Text fw={700} size="xl" c="green">
              ${monthlyTotal.toFixed(2)}
            </Text>
            <Group gap="xs">
              <Text size="xs" c="green.6" fw={500}>${monthlyPaid.toFixed(2)} paid</Text>
              <Text size="xs" c="dimmed">|</Text>
              <Text size="xs" c="orange.6" fw={500}>${monthlyRemaining.toFixed(2)} remaining</Text>
            </Group>
          </Stack>
          <ThemeIcon color="green" variant="light" size="lg" radius="md">
            <IconCoin size={20} />
          </ThemeIcon>
        </Group>
      </Paper>
    </SimpleGrid>
  );
}
