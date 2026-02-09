import { useMemo } from 'react';
import { Stack, Title, Text, Group, Badge, Divider, NavLink } from '@mantine/core';
import { IconCalendar, IconHome, IconReceipt, IconChartPie, IconListDetails } from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Bill } from '../api/client';
import type { BillFilter, DateRangeFilter } from '../App';

interface SidebarProps {
  bills: Bill[];
  isLoggedIn: boolean;
  filter: BillFilter;
  onFilterChange: (filter: BillFilter) => void;
}

export function Sidebar({ bills, isLoggedIn, filter, onFilterChange }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Parse date directly to avoid timezone issues
  const parseDate = (dateStr: string): Date => {
    try {
      if (!dateStr || typeof dateStr !== 'string') {
        return new Date();
      }
      const parts = dateStr.split('-');
      if (parts.length !== 3) {
        return new Date();
      }
      const [year, month, day] = parts.map(Number);
      if (isNaN(year) || isNaN(month) || isNaN(day)) {
        return new Date();
      }
      const d = new Date(year, month - 1, day);
      d.setHours(0, 0, 0, 0);
      return d;
    } catch {
      return new Date();
    }
  };

  // Upcoming bills stats
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
      selectedDate: null,
    });
    navigate('/bills');
  };

  const isRangeActive = (range: DateRangeFilter) => filter.dateRange === range;

  return (
    <Stack gap="xs">
      {/* Navigation Links */}
      {isLoggedIn && (
        <>
          <NavLink
            label="Dashboard"
            leftSection={<IconHome size={16} />}
            active={location.pathname === '/'}
            onClick={() => navigate('/')}
            variant="light"
          />
          <NavLink
            label="Bills"
            leftSection={<IconReceipt size={16} />}
            active={location.pathname === '/bills'}
            onClick={() => navigate('/bills')}
            variant="light"
          />
          <NavLink
            label="Payment History"
            leftSection={<IconListDetails size={16} />}
            active={location.pathname === '/all-payments'}
            onClick={() => navigate('/all-payments')}
            variant="light"
          />
          <NavLink
            label="Calendar"
            leftSection={<IconCalendar size={16} />}
            active={location.pathname === '/calendar'}
            onClick={() => navigate('/calendar')}
            variant="light"
          />
          <NavLink
            label="Analytics"
            leftSection={<IconChartPie size={16} />}
            active={location.pathname === '/analytics'}
            onClick={() => navigate('/analytics')}
            variant="light"
          />
          <Divider my="xs" />
        </>
      )}

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
