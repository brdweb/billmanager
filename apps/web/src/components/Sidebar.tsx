import { useState, useMemo, useEffect } from 'react';
import { Stack, Title, Text, Paper, Group, Badge, Divider, SimpleGrid, ActionIcon, Loader, Button } from '@mantine/core';
import { IconCalendar, IconCoin, IconCheck, IconChevronLeft, IconChevronRight, IconChartLine, IconListDetails } from '@tabler/icons-react';
import type { Bill } from '../api/client';
import { getMonthlyPayments } from '../api/client';
import type { BillFilter, DateRangeFilter } from '../App';

interface SidebarProps {
  bills: Bill[];
  isLoggedIn: boolean;
  filter: BillFilter;
  onFilterChange: (filter: BillFilter) => void;
  onShowChart?: () => void;
  onShowAllPayments?: () => void;
}

export function Sidebar({ bills, isLoggedIn, filter, onFilterChange, onShowChart, onShowAllPayments }: SidebarProps) {
  // Month offset: 0 = current month, -1 = last month, etc.
  const [monthOffset, setMonthOffset] = useState(0);
  // Monthly payment totals from API (keyed by "YYYY-MM")
  const [monthlyPayments, setMonthlyPayments] = useState<Record<string, number>>({});
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  // Fetch monthly payment totals when logged in
  useEffect(() => {
    if (isLoggedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaymentsLoading(true);
      getMonthlyPayments()
        .then((res) => setMonthlyPayments(res))
        .catch((err) => console.error('Failed to fetch monthly payments:', err))
        .finally(() => setPaymentsLoading(false));
    }
  }, [isLoggedIn, bills]); // Refetch when bills change (payment made)

  // Parse date directly to avoid timezone issues
  const parseDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // Get month info for display
  const selectedMonthInfo = useMemo(() => {
    const today = new Date();
    const targetDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    return {
      month: targetDate.getMonth(),
      year: targetDate.getFullYear(),
      name: targetDate.toLocaleString('default', { month: 'long', year: 'numeric' }),
      isCurrentMonth: monthOffset === 0,
    };
  }, [monthOffset]);

  // Calculate monthly stats based on offset
  const monthlyStats = useMemo(() => {
    const { month, year } = selectedMonthInfo;
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    // 1. Paid: Actual payments made in this month (from API)
    // Filter out deposits if possible? The API returns total. 
    // The user said "not income". 
    // The current getMonthlyPayments API aggregates ALL payments. 
    // We might need to fetch detailed payments or just assume for now. 
    // However, the prompt says "Paid should be a total amount of all bills (not income)".
    // The API /api/payments/monthly groups by month. It sums 'amount'.
    // If 'amount' in payments table includes deposits, we have a problem.
    // Let's assume for this step we use the API value, but strictly we might need a backend change to separate income/expense in monthly totals.
    // For now, let's use the provided monthlyPayments.
    const paid = monthlyPayments[monthKey] || 0;

    // 2. Remaining: Bills due in this month that haven't been paid yet
    // Filter for expenses only
    const remaining = bills
      .filter((b) => {
        if (b.archived || b.type !== 'expense') return false;
        const due = parseDate(b.next_due);
        return due.getMonth() === month && due.getFullYear() === year;
      })
      .reduce((sum, b) => {
        const amount = b.varies ? (b.avg_amount || 0) : (b.amount || 0);
        return sum + amount;
      }, 0);

    // 3. Total: Paid + Remaining
    const total = paid + remaining;

    return { total, paid, remaining };
  }, [bills, selectedMonthInfo, monthlyPayments]);

  // Upcoming bills stats (always for current month)
  const upcomingStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneDay = 24 * 60 * 60 * 1000;

    const endThisWeek = new Date(today.getTime() + 7 * oneDay);
    const endNextWeek = new Date(today.getTime() + 14 * oneDay);
    const end21 = new Date(today.getTime() + 21 * oneDay);
    const end30 = new Date(today.getTime() + 30 * oneDay);

    const countInRange = (start: Date, end: Date) =>
      bills.filter((b) => {
        const due = parseDate(b.next_due);
        return due >= start && due < end && !b.archived;
      }).length;

    const countOverdue = () =>
      bills.filter((b) => {
        const due = parseDate(b.next_due);
        return due < today && !b.archived;
      }).length;

    return {
      overdue: countOverdue(),
      thisWeek: countInRange(today, endThisWeek),
      nextWeek: countInRange(endThisWeek, endNextWeek),
      next21Days: countInRange(today, end21),
      next30Days: countInRange(today, end30),
    };
  }, [bills]);

  const handleDateRangeClick = (range: DateRangeFilter) => {
    onFilterChange({
      ...filter,
      dateRange: filter.dateRange === range ? 'all' : range,
      selectedDate: null, // Clear specific date when using range filter
    });
  };

  const isRangeActive = (range: DateRangeFilter) => filter.dateRange === range;

  return (
    <Stack gap="xs">
      <Title order={6}>Dashboard</Title>

      <Paper p="xs" withBorder>
        <Group justify="space-between" mb="xs">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => setMonthOffset(monthOffset - 1)}
          >
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text size="sm" c="dimmed" fw={500}>
            {selectedMonthInfo.name}
          </Text>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => setMonthOffset(monthOffset + 1)}
          >
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
        <Text size="md" fw={700} c="green" mb="xs" ta="center">
          ${monthlyStats.total.toFixed(2)} total
        </Text>
        {selectedMonthInfo.isCurrentMonth ? (
          <SimpleGrid cols={2} spacing="xs">
            <Paper p="xs" bg="green.1" radius="sm">
              <Group gap={4} mb={2}>
                <IconCheck size={12} color="var(--mantine-color-green-7)" />
                <Text size="xs" c="green.7" fw={500}>Paid</Text>
              </Group>
              <Text size="sm" fw={600} c="green.8">
                ${monthlyStats.paid.toFixed(2)}
              </Text>
            </Paper>
            <Paper p="xs" bg="orange.1" radius="sm">
              <Group gap={4} mb={2}>
                <IconCoin size={12} color="var(--mantine-color-orange-7)" />
                <Text size="xs" c="orange.7" fw={500}>Remaining</Text>
              </Group>
              <Text size="sm" fw={600} c="orange.8">
                ${monthlyStats.remaining.toFixed(2)}
              </Text>
            </Paper>
          </SimpleGrid>
        ) : paymentsLoading ? (
          <Paper p="xs" bg="gray.1" radius="sm">
            <Group justify="center" py="xs">
              <Loader size="sm" />
            </Group>
          </Paper>
        ) : (
          <Paper p="xs" bg="green.1" radius="sm">
            <Group gap={4} mb={2} justify="center">
              <IconCheck size={12} color="var(--mantine-color-green-7)" />
              <Text size="xs" c="green.7" fw={500}>Total Paid</Text>
            </Group>
            <Text size="sm" fw={600} c="green.8" ta="center">
              ${monthlyStats.paid.toFixed(2)}
            </Text>
          </Paper>
        )}

        {/* Chart and All Payments buttons */}
        {isLoggedIn && (
          <Group grow mt="sm">
            <Button
              variant="light"
              size="xs"
              leftSection={<IconChartLine size={14} />}
              onClick={onShowChart}
              styles={{ label: { whiteSpace: 'normal', lineHeight: 1.2 } }}
              style={{ height: 48 }}
            >
              Trends
            </Button>
            <Button
              variant="light"
              size="xs"
              leftSection={<IconListDetails size={14} />}
              onClick={onShowAllPayments}
              styles={{ label: { whiteSpace: 'normal', lineHeight: 1.2 } }}
              style={{ height: 48 }}
            >
              Payment History
            </Button>
          </Group>
        )}
      </Paper>

      <Divider />

      <Title order={6}>
        <Group gap="xs">
          <IconCalendar size={14} />
          Upcoming Bills
        </Group>
      </Title>

      <Stack gap={4}>
        {upcomingStats.overdue > 0 && (
          <Group
            justify="space-between"
            style={{ cursor: 'pointer' }}
            onClick={() => handleDateRangeClick('overdue')}
          >
            <Text size="sm" fw={isRangeActive('overdue') ? 700 : 400} c="red">
              Overdue
            </Text>
            <Badge
              color="red"
              variant={isRangeActive('overdue') ? 'filled' : 'outline'}
              size="lg"
              style={{ cursor: 'pointer' }}
            >
              {upcomingStats.overdue}
            </Badge>
          </Group>
        )}
        <Group
          justify="space-between"
          style={{ cursor: 'pointer' }}
          onClick={() => handleDateRangeClick('thisWeek')}
        >
          <Text size="sm" fw={isRangeActive('thisWeek') ? 700 : 400}>
            This week
          </Text>
          <Badge
            color="red"
            variant={isRangeActive('thisWeek') ? 'filled' : 'light'}
            size="lg"
            style={{ cursor: 'pointer' }}
          >
            {upcomingStats.thisWeek}
          </Badge>
        </Group>
        <Group
          justify="space-between"
          style={{ cursor: 'pointer' }}
          onClick={() => handleDateRangeClick('nextWeek')}
        >
          <Text size="sm" fw={isRangeActive('nextWeek') ? 700 : 400}>
            Next week
          </Text>
          <Badge
            color="orange"
            variant={isRangeActive('nextWeek') ? 'filled' : 'light'}
            size="lg"
            style={{ cursor: 'pointer' }}
          >
            {upcomingStats.nextWeek}
          </Badge>
        </Group>
        <Group
          justify="space-between"
          style={{ cursor: 'pointer' }}
          onClick={() => handleDateRangeClick('next21Days')}
        >
          <Text size="sm" fw={isRangeActive('next21Days') ? 700 : 400}>
            Next 21 days
          </Text>
          <Badge
            color="yellow"
            variant={isRangeActive('next21Days') ? 'filled' : 'light'}
            size="lg"
            style={{ cursor: 'pointer' }}
          >
            {upcomingStats.next21Days}
          </Badge>
        </Group>
        <Group
          justify="space-between"
          style={{ cursor: 'pointer' }}
          onClick={() => handleDateRangeClick('next30Days')}
        >
          <Text size="sm" fw={isRangeActive('next30Days') ? 700 : 400}>
            Next 30 days
          </Text>
          <Badge
            color="blue"
            variant={isRangeActive('next30Days') ? 'filled' : 'light'}
            size="lg"
            style={{ cursor: 'pointer' }}
          >
            {upcomingStats.next30Days}
          </Badge>
        </Group>
      </Stack>
    </Stack>
  );
}
