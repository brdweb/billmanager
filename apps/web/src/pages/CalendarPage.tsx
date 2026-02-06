import { useState } from 'react';
import { Stack, Title, Group, Button, Paper, Center, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconCalendar } from '@tabler/icons-react';
import { MultiMonthCalendar } from '../components/MultiMonthCalendar';
import { DayDetailModal } from '../components/DayDetailModal';
import type { Bill } from '../api/client';

interface CalendarPageProps {
  bills: Bill[];
  onAddBill: () => void;
  onPayBill: (bill: Bill) => void;
  onEditBill: (bill: Bill) => void;
  hasDatabase: boolean;
}

export function CalendarPage({
  bills,
  onAddBill,
  onPayBill,
  onEditBill,
  hasDatabase,
}: CalendarPageProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewMonths, setViewMonths] = useState<1 | 3 | 6>(3);
  const [dayModalOpened, { open: openDayModal, close: closeDayModal }] = useDisclosure(false);

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    openDayModal();
  };

  if (!hasDatabase) {
    return (
      <Center py="xl">
        <Paper withBorder p="xl" radius="md" ta="center" maw={400}>
          <IconCalendar size={48} color="var(--mantine-color-dimmed)" />
          <Title order={3} mt="md">
            No Bill Group Selected
          </Title>
          <Text c="dimmed" mt="sm">
            Select a bill group from the header to view the calendar.
          </Text>
        </Paper>
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between" align="center">
        <Title order={2}>Calendar</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={onAddBill}>
          Add Bill
        </Button>
      </Group>

      {/* Multi-Month Calendar */}
      <Paper withBorder p="md" radius="md">
        <MultiMonthCalendar
          bills={bills}
          selectedDate={selectedDate}
          onDateSelect={handleDateSelect}
          viewMonths={viewMonths}
          onViewChange={setViewMonths}
          showViewSelector
        />
      </Paper>

      {/* Day Detail Modal */}
      <DayDetailModal
        opened={dayModalOpened}
        onClose={closeDayModal}
        date={selectedDate}
        bills={bills}
        onPay={onPayBill}
        onEdit={onEditBill}
      />
    </Stack>
  );
}
