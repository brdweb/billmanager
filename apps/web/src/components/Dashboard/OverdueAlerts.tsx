import { Paper, Text, Group, Button, Stack, Box, Alert } from '@mantine/core';
import { IconAlertTriangle, IconCoin } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Bill } from '../../api/client';
import { formatCurrency } from '../../lib/currency';

interface OverdueAlertsProps {
  bills: Bill[];
  onPay: (bill: Bill) => void;
}

export function OverdueAlerts({ bills, onPay }: OverdueAlertsProps) {
  const { t } = useTranslation();

  // Get today's date at midnight
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parse date string to Date object
  const parseDate = (dateStr: string): Date => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // Get days overdue
  const getDaysOverdue = (dateStr: string): number => {
    const due = parseDate(dateStr);
    const diffTime = today.getTime() - due.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Filter overdue bills (expenses only, not archived)
  const overdueBills = bills
    .filter((b) => {
      if (b.archived || b.type !== 'expense') return false;
      const due = parseDate(b.next_due);
      return due < today;
    })
    .sort((a, b) => parseDate(a.next_due).getTime() - parseDate(b.next_due).getTime());

  if (overdueBills.length === 0) {
    return null;
  }

  return (
    <Alert
      color="red"
      variant="light"
      icon={<IconAlertTriangle size={20} />}
      title={t('dashboard.overdueAlerts.title', { count: overdueBills.length })}
    >
      <Stack gap="xs" mt="sm">
        {overdueBills.slice(0, 5).map((bill) => {
          const daysOverdue = getDaysOverdue(bill.next_due);
          const amount = bill.varies ? (bill.avg_amount || 0) : (bill.amount || 0);

          return (
            <Paper key={bill.id} withBorder p="sm" radius="sm">
              <Group justify="space-between" wrap="nowrap">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={500} truncate style={{ maxWidth: 200 }}>
                    {bill.name}
                  </Text>
                  <Text size="xs" c="red">
                    {t('dashboard.overdueAlerts.daysOverdue', { count: daysOverdue, amount: formatCurrency(amount) })}
                  </Text>
                </Box>
                <Button
                  variant="filled"
                  size="xs"
                  color="red"
                  leftSection={<IconCoin size={14} />}
                  onClick={() => onPay(bill)}
                >
                  {t('common.actions.payNow')}
                </Button>
              </Group>
            </Paper>
          );
        })}
        {overdueBills.length > 5 && (
          <Text size="xs" c="dimmed" ta="center">
            {t('dashboard.overdueAlerts.moreOverdue', { count: overdueBills.length - 5 })}
          </Text>
        )}
      </Stack>
    </Alert>
  );
}
