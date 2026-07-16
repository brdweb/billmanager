import { useEffect, useState } from 'react';
import { Affix, Badge, Button, Drawer, Group, Paper, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertTriangle, IconBellRinging } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

// The backend's alert.title/alert.message are plain hardcoded English text
// (not localized). Rebuild both from the structured fields instead of
// rendering them directly, same as the create/edit form already does for
// bill frequency labels.
function alertTitle(alert: ReminderAlert, t: TFunction): string {
  switch (alert.type) {
    case 'overdue':
      return t('reminderAlertsWidget.titleOverdue', { name: alert.bill_name });
    case 'due_today':
      return t('reminderAlertsWidget.titleDueToday', { name: alert.bill_name });
    case 'deposit_today':
      return t('reminderAlertsWidget.titleDepositToday', { name: alert.bill_name });
    case 'upcoming':
      return t('reminderAlertsWidget.titleDueInDays', { name: alert.bill_name, count: alert.days_until_due });
    case 'deposit_expected':
      return t('reminderAlertsWidget.titleDepositInDays', { name: alert.bill_name, count: alert.days_until_due });
    default:
      return alert.title;
  }
}

function alertMessage(alert: ReminderAlert, t: TFunction): string {
  switch (alert.type) {
    case 'overdue':
      return t('reminderAlertsWidget.messageOverdue', { count: Math.abs(alert.days_until_due) });
    case 'due_today':
      return t('reminderAlertsWidget.messageRecordPayment');
    case 'deposit_today':
      return t('reminderAlertsWidget.messageDepositToday');
    case 'upcoming':
    case 'deposit_expected':
      return t('reminderAlertsWidget.messageUpcomingWindow');
    default:
      return alert.message;
  }
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
                      <Text fw={600}>{alertTitle(alert, t)}</Text>
                      <Badge
                        size="xs"
                        color={alert.severity === 'critical' ? 'red' : alert.severity === 'warning' ? 'yellow' : 'blue'}
                        variant="light"
                      >
                        {alert.database_name}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {alertMessage(alert, t)}
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
