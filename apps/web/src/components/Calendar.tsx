import { useMemo } from 'react';
import { Paper, Title, SimpleGrid, Text, Center, Stack, Badge } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Bill } from '../api/client';
import { getLocale } from '../lib/currency';

interface CalendarProps {
  bills: Bill[];
  selectedDate: string | null; // YYYY-MM-DD format
  onDateSelect: (date: string) => void;
}

export function Calendar({ bills, selectedDate, onDateSelect }: CalendarProps) {
  const { t } = useTranslation();
  const calendarData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthName = now.toLocaleString(getLocale(), { month: 'long' });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Get due dates for this month (excluding archived bills)
    // Parse date strings directly to avoid timezone issues with new Date()
    const dueDates = new Map<number, number>();
    bills.filter((bill) => !bill.archived).forEach((bill) => {
      const [billYear, billMonth, billDay] = bill.next_due.split('-').map(Number);
      if (billMonth - 1 === month && billYear === year) {
        dueDates.set(billDay, (dueDates.get(billDay) || 0) + 1);
      }
    });

    // Parse selected date to get day number (if in current month)
    let selectedDay: number | null = null;
    if (selectedDate) {
      const [selYear, selMonth, selDay] = selectedDate.split('-').map(Number);
      if (selYear === year && selMonth - 1 === month) {
        selectedDay = selDay;
      }
    }

    return {
      year,
      month,
      monthName,
      firstDay,
      daysInMonth,
      dueDates,
      today: now.getDate(),
      selectedDay,
    };
  }, [bills, selectedDate]);

  const weeks = useMemo(() => {
    const { firstDay, daysInMonth } = calendarData;
    const days: (number | null)[] = [];

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }

    // Split into weeks
    const result: (number | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7));
    }

    return result;
  }, [calendarData]);

  return (
    <Paper p={6} withBorder>
      <Stack gap={2}>
        <Title order={6} ta="center" mb={2}>
          {calendarData.monthName} {calendarData.year}
        </Title>

        <SimpleGrid cols={7} spacing={1}>
          {(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const).map((day) => (
            <Text key={day} size="xs" fw={600} ta="center" c="dimmed">
              {t(`common.weekdaysShort.${day}`)}
            </Text>
          ))}
        </SimpleGrid>

        {weeks.map((week, weekIndex) => (
          <SimpleGrid key={weekIndex} cols={7} spacing={1}>
            {week.map((day, dayIndex) => {
              if (day === null) {
                return <div key={`empty-${dayIndex}`} />;
              }

              const billCount = calendarData.dueDates.get(day) || 0;
              const isToday = day === calendarData.today;
              const isSelected = day === calendarData.selectedDay;

              // Build the date string for click handler
              const dateStr = `${calendarData.year}-${String(calendarData.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

              // Determine background color (priority: selected > bills > today)
              let background: string | undefined;
              if (isSelected) {
                background = 'var(--mantine-color-blue-light)';
              } else if (billCount > 0) {
                background = 'var(--mantine-color-yellow-light)';
              } else if (isToday) {
                background = 'var(--mantine-color-violet-light)';
              }

              // Determine border (selected gets blue, today gets violet)
              let border: string | undefined;
              if (isSelected) {
                border = '2px solid var(--mantine-color-blue-6)';
              } else if (isToday) {
                border = '2px solid var(--mantine-color-violet-6)';
              }

              // Determine text color
              let textColor: string | undefined;
              if (isSelected) {
                textColor = 'blue';
              } else if (billCount > 0) {
                textColor = 'yellow.8';
              } else if (isToday) {
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
                  }}
                >
                  <Text
                    size="xs"
                    fw={isToday || billCount > 0 || isSelected ? 600 : 400}
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
                        top: -4,
                        right: -4,
                        fontSize: 7,
                        padding: '0 3px',
                        minWidth: 'auto',
                        height: 14,
                        lineHeight: '14px',
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
