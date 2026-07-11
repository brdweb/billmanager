import { useEffect, useState } from 'react';
import { Affix, Badge, Button, Drawer, Group, Paper, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertTriangle, IconBellRinging } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Bill, ReminderAlert } from '../api/client';
import { getReminderAlerts } from '../api/client';
import { formatCurrency } from '../lib/currency';

interface ReminderAlertsWidgetProps {
  bills: Bill[];
  hasDatabase: boolean;
  onPayBill: (bill: Bill) => void;
}

function alertColor(alerts: ReminderAlert[]) {
  return alerts.some((alert) => alert.severity === 'critical') ? 'red' : 'yellow';
}

export function ReminderAlertsWidget({ bills, hasDatabase, onPayBill }: ReminderAlertsWidgetProps) {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<ReminderAlert[]>([]);
  const [opened, { open, close }] = useDisclosure(false);

  useEffect(() => {
    if (!hasDatabase) {
      setAlerts([]);
      close();
      return;
    }

    let cancelled = false;

    getReminderAlerts()
      .then((res) => {
        if (!cancelled) setAlerts(Array.isArray(res) ? res : []);
      })
      .catch(() => {
        if (!cancelled) setAlerts([]);
      });

    return () => {
      cancelled = true;
    };
  }, [hasDatabase, bills, close]);

  if (alerts.length === 0) {
    return null;
  }

  const color = alertColor(alerts);

  return (
    <>
      {!opened && (
        <Affix position={{ bottom: 24, right: 24 }} zIndex={210}>
          <UnstyledButton onClick={open} aria-label={t('reminderAlertsWidget.openAriaLabel')}>
            <Paper withBorder shadow="md" radius="md" px="sm" py="xs">
              <Group gap="xs" wrap="nowrap">
                <ThemeIcon color={color} variant="light" radius="xl" size="md">
                  <IconBellRinging size={18} />
                </ThemeIcon>
                <Stack gap={0}>
                  <Text size="sm" fw={700}>
                    {t('reminderAlertsWidget.alertCount', { count: alerts.length })}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t('reminderAlertsWidget.clickToReview')}
                  </Text>
                </Stack>
              </Group>
            </Paper>
          </UnstyledButton>
        </Affix>
      )}

      <Drawer
        opened={opened}
        onClose={close}
        position="right"
        size="md"
        closeOnClickOutside={false}
        closeOnEscape={false}
        closeButtonProps={{ 'aria-label': t('reminderAlertsWidget.closeAriaLabel') }}
        title={t('reminderAlertsWidget.alertCount', { count: alerts.length })}
      >
        <Stack gap="sm">
          {alerts.map((alert) => {
            const bill = bills.find((item) => item.id === alert.bill_id);
            return (
              <Paper key={`${alert.type}-${alert.bill_id}-${alert.due_date}`} withBorder p="sm" radius="sm">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Group gap="xs">
                      <Text fw={600}>{alert.title}</Text>
                      <Badge
                        size="xs"
                        color={alert.severity === 'critical' ? 'red' : alert.severity === 'warning' ? 'yellow' : 'blue'}
                        variant="light"
                      >
                        {alert.database_name}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {alert.message}
                      {alert.amount !== null ? ` - ${formatCurrency(alert.amount)}` : ''}
                    </Text>
                  </Stack>
                  {bill && bill.type !== 'deposit' && !bill.is_shared && (
                    <Button
                      size="xs"
                      color={alert.severity === 'critical' ? 'red' : 'green'}
                      leftSection={<IconAlertTriangle size={14} />}
                      onClick={() => onPayBill(bill)}
                    >
                      {t('common.actions.pay')}
                    </Button>
                  )}
                </Group>
              </Paper>
            );
          })}
        </Stack>
      </Drawer>
    </>
  );
}
