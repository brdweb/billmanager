import { useMemo, useState } from 'react';
import { Paper, SimpleGrid, Text, Center, Stack, Badge, Group, ActionIcon, Button, SegmentedControl, Title } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import type { Bill } from '../api/client';

interface MultiMonthCalendarProps {
  bills: Bill[];
  selectedDate: string | null;
  onDateSelect: (date: string) => void;
  viewMonths?: 1 | 3 | 6;
  onViewChange?: (months: 1 | 3 | 6) => void;
  showViewSelector?: boolean;
}

interface MonthData {
  year: number;
  month: number;
  monthName: string;
  firstDay: number;
  daysInMonth: number;
  dueDates: Map<number, { count: number; hasExpense: boolean; hasDeposit: boolean }>;
}

function SingleMonth({
  monthData,
  selectedDate,
  onDateSelect,
  today,
  compact = false,
}: {
  monthData: MonthData;
  selectedDate: string | null;
  onDateSelect: (date: string) => void;
  today: { year: number; month: number; day: number };
  compact?: boolean;
}) {
  const weeks = useMemo(() => {
    const { firstDay, daysInMonth } = monthData;
    const days: (number | null)[] = [];

    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }

    const result: (number | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7));
    }

    return result;
  }, [monthData]);

  // Parse selected date
  let selectedDay: number | null = null;
  if (selectedDate) {
    const [selYear, selMonth, selDay] = selectedDate.split('-').map(Number);
    if (selYear === monthData.year && selMonth - 1 === monthData.month) {
      selectedDay = selDay;
    }
  }

  const isToday = (day: number) =>
    today.year === monthData.year && today.month === monthData.month && today.day === day;

  return (
    <Paper p={compact ? 'xs' : 'sm'} withBorder>
      <Stack gap={2}>
        <Title order={6} ta="center" mb={compact ? 2 : 'xs'} size={compact ? 'xs' : 'sm'}>
          {monthData.monthName} {monthData.year}
        </Title>

        <SimpleGrid cols={7} spacing={1}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
            <Text key={`${day}-${i}`} size="xs" fw={600} ta="center" c="dimmed">
              {day}
            </Text>
          ))}
        </SimpleGrid>

        {weeks.map((week, weekIndex) => (
          <SimpleGrid key={weekIndex} cols={7} spacing={1}>
            {week.map((day, dayIndex) => {
              if (day === null) {
                return <div key={`empty-${dayIndex}`} />;
              }

              const billInfo = monthData.dueDates.get(day);
              const billCount = billInfo?.count || 0;
              const isTodayDate = isToday(day);
              const isSelected = day === selectedDay;

              const dateStr = `${monthData.year}-${String(monthData.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

              // Determine background color (matches sidebar calendar)
              let background: string | undefined;
              if (isSelected) {
                background = 'var(--mantine-color-blue-light)';
              } else if (billCount > 0) {
                background = 'var(--mantine-color-yellow-light)';
              } else if (isTodayDate) {
                background = 'var(--mantine-color-violet-light)';
              }

              let border: string | undefined;
              if (isSelected) {
                border = '2px solid var(--mantine-color-blue-6)';
              } else if (isTodayDate) {
                border = '2px solid var(--mantine-color-violet-6)';
              }

              let textColor: string | undefined;
              if (isSelected) {
                textColor = 'blue';
              } else if (billCount > 0) {
                textColor = 'yellow.8';
              } else if (isTodayDate) {
                textColor = 'violet';
              }

              return (
                <Center
                  key={day}
                  onClick={() => onDateSelect(dateStr)}
                  style={{
                    aspectRatio: '1',
                    borderRadius: 'var(--mantine-radius-sm)',
                    background,
                    border,
                    position: 'relative',
                    cursor: 'pointer',
                    minHeight: compact ? 24 : 28,
                  }}
                >
                  <Text
                    size={compact ? '10px' : 'xs'}
                    fw={isTodayDate || billCount > 0 || isSelected ? 600 : 400}
                    c={textColor}
                  >
                    {day}
                  </Text>
                  {billCount > 1 && (
                    <Badge
                      size="xs"
                      color="red"
                      variant="filled"
                      style={{
                        position: 'absolute',
                        top: -3,
                        right: -3,
                        fontSize: compact ? 6 : 7,
                        padding: '0 2px',
                        minWidth: 'auto',
                        height: compact ? 12 : 14,
                        lineHeight: compact ? '12px' : '14px',
                      }}
                    >
                      {billCount}
                    </Badge>
                  )}
                </Center>
              );
            })}
          </SimpleGrid>
        ))}
      </Stack>
    </Paper>
  );
}

export function MultiMonthCalendar({
  bills,
  selectedDate,
  onDateSelect,
  viewMonths = 1,
  onViewChange,
  showViewSelector = true,
}: MultiMonthCalendarProps) {
  const [baseOffset, setBaseOffset] = useState(0);

  const today = useMemo(() => {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth(),
      day: now.getDate(),
    };
  }, []);

  const monthsData = useMemo(() => {
    const result: MonthData[] = [];
    const now = new Date();

    for (let i = 0; i < viewMonths; i++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() + baseOffset + i, 1);
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();
      const monthName = targetDate.toLocaleString('default', { month: 'long' });
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      // Build due dates map with bill type info
      const dueDates = new Map<number, { count: number; hasExpense: boolean; hasDeposit: boolean }>();
      bills.filter((bill) => !bill.archived).forEach((bill) => {
        const [billYear, billMonth, billDay] = bill.next_due.split('-').map(Number);
        if (billMonth - 1 === month && billYear === year) {
          const existing = dueDates.get(billDay) || { count: 0, hasExpense: false, hasDeposit: false };
          existing.count++;
          if (bill.type === 'expense') existing.hasExpense = true;
          if (bill.type === 'deposit') existing.hasDeposit = true;
          dueDates.set(billDay, existing);
        }
      });

      result.push({ year, month, monthName, firstDay, daysInMonth, dueDates });
    }

    return result;
  }, [bills, baseOffset, viewMonths]);

  const handlePrev = () => setBaseOffset((o) => o - 1);
  const handleNext = () => setBaseOffset((o) => o + 1);
  const handleToday = () => setBaseOffset(0);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Group gap="xs">
          <ActionIcon variant="subtle" onClick={handlePrev}>
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Button variant="light" size="compact-xs" onClick={handleToday}>
            Today
          </Button>
          <ActionIcon variant="subtle" onClick={handleNext}>
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>

        {showViewSelector && onViewChange && (
          <SegmentedControl
            size="xs"
            value={String(viewMonths)}
            onChange={(v) => onViewChange(Number(v) as 1 | 3 | 6)}
            data={[
              { label: '1 Month', value: '1' },
              { label: '3 Months', value: '3' },
              { label: '6 Months', value: '6' },
            ]}
          />
        )}
      </Group>

      {/* Legend */}
      <Group gap="md" justify="center">
        <Group gap={4}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--mantine-color-yellow-light)' }} />
          <Text size="xs" c="dimmed">Bills Due</Text>
        </Group>
        <Group gap={4}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--mantine-color-violet-light)', border: '2px solid var(--mantine-color-violet-6)' }} />
          <Text size="xs" c="dimmed">Today</Text>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: viewMonths > 1 ? 2 : 1, md: viewMonths > 2 ? 3 : viewMonths }}>
        {monthsData.map((monthData) => (
          <SingleMonth
            key={`${monthData.year}-${monthData.month}`}
            monthData={monthData}
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
            today={today}
            compact={viewMonths > 1}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}
