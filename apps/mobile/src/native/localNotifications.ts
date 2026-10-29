import { SecureProfileTokenStore } from '../api/tokenStore';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import type { Bill } from '../types';
import i18n from '../i18n';
import { formatCurrency } from '../i18n/format';
import { buildReminderSchedule } from './reminderSchedule';

export const BILL_REMINDER_CATEGORY = 'bill-reminder';
export const BILL_REMINDER_CHANNEL = 'bill-reminders';
export const NOTIFICATION_ACTIONS = {
  open: 'OPEN_BILL',
  snooze: 'SNOOZE_BILL',
  markPaid: 'MARK_BILL_PAID',
} as const;

const NOTIFICATION_SOURCE = 'billmanager-local-reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export interface NotificationActionHandlers {
  isScopeAuthorized?: (scope: NotificationScope) => boolean | Promise<boolean>;
  onOpenBill: (billId: number, scope: NotificationScope) => void | Promise<void>;
  onMarkPaid: (billId: number, scope: NotificationScope) => void | Promise<void>;
  onSnooze?: (billId: number, scope: NotificationScope, snoozedUntil: string, notificationId: string, dueDate: string | null) => void | Promise<void>;
}

export interface NotificationScope {
  serverProfileId: string;
  databaseId: string;
  principalId?: string;
}

export async function configureLocalNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(BILL_REMINDER_CHANNEL, {
      name: i18n.t('mobileCore.notifications.channelName'),
      description: i18n.t('mobileCore.notifications.channelDescription'),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: '#00875A',
      sound: 'default',
    });
  }

  await Notifications.setNotificationCategoryAsync(BILL_REMINDER_CATEGORY, [
    {
      identifier: NOTIFICATION_ACTIONS.open,
      buttonTitle: i18n.t('mobileCore.notifications.open'),
      options: { opensAppToForeground: true },
    },
    {
      identifier: NOTIFICATION_ACTIONS.snooze,
      buttonTitle: i18n.t('mobileCore.notifications.snooze'),
      options: { opensAppToForeground: false },
    },
    {
      identifier: NOTIFICATION_ACTIONS.markPaid,
      buttonTitle: i18n.t('mobileCore.notifications.markPaid'),
      options: { opensAppToForeground: true, isAuthenticationRequired: true },
    },
  ]);
}

export async function requestLocalNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export function subscribeToNotificationActions(handlers: NotificationActionHandlers): () => void {
  if (Platform.OS === 'web') return () => undefined;

  const subscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
    const data = response.notification.request.content.data;
    const billId = Number(data?.billId);
    const serverProfileId = typeof data?.serverProfileId === 'string' ? data.serverProfileId : '';
    const databaseId = typeof data?.databaseId === 'string' ? data.databaseId : '';
    if (!Number.isInteger(billId) || !serverProfileId || !databaseId) return;
    const principalId = typeof data?.principalId === 'string' ? data.principalId : undefined;
    const scope = { serverProfileId, databaseId, ...(principalId ? { principalId } : {}) };
    if (!await ownsReminderScope(scope) || (handlers.isScopeAuthorized && !await handlers.isScopeAuthorized(scope))) return;

    if (response.actionIdentifier === NOTIFICATION_ACTIONS.snooze) {
      const content = response.notification.request.content;
      const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: content.title ?? undefined,
          subtitle: content.subtitle ?? undefined,
          body: content.body ?? undefined,
          data: content.data,
          categoryIdentifier: content.categoryIdentifier ?? undefined,
          sound: content.sound ?? 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: snoozedUntil,
          channelId: BILL_REMINDER_CHANNEL,
        },
      });
      if (!await ownsReminderScope(scope) || (handlers.isScopeAuthorized && !await handlers.isScopeAuthorized(scope))) {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
        return;
      }
      const dueDate = typeof data?.dueDate === 'string' ? data.dueDate : null;
      await handlers.onSnooze?.(billId, scope, snoozedUntil.toISOString(), notificationId, dueDate);
      return;
    }

    if (response.actionIdentifier === NOTIFICATION_ACTIONS.markPaid) {
      await handlers.onMarkPaid(billId, scope);
      return;
    }

    await handlers.onOpenBill(billId, scope);
  });

  return () => subscription.remove();
}

export async function snoozeLocalBillReminder(
  bill: Bill,
  scope: NotificationScope,
  snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000),
): Promise<string | null> {
  if (Platform.OS === 'web' || !await ownsReminderScope(scope)) return null;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return null;
  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: bill.name,
      body: i18n.t('mobileCore.notifications.snoozedBody'),
      categoryIdentifier: BILL_REMINDER_CATEGORY,
      sound: 'default',
      data: {
        source: NOTIFICATION_SOURCE,
        billId: bill.id,
        dueDate: bill.next_due,
        serverProfileId: scope.serverProfileId,
        databaseId: scope.databaseId,
        ...(scope.principalId ? { principalId: scope.principalId } : {}),
        url: `billmanager://bills/${bill.id}`,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: snoozedUntil,
      channelId: BILL_REMINDER_CHANNEL,
    },
  });
  if (!await ownsReminderScope(scope)) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
    return null;
  }
  return identifier;
}

export async function cancelPrincipalReminders(serverProfileId: string, principalId?: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(existing.filter((item) => item.content.data?.source === NOTIFICATION_SOURCE
    && item.content.data?.serverProfileId === serverProfileId
    && item.content.data?.principalId === principalId)
    .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
}

export async function cancelOtherPrincipalReminders(serverProfileId: string, principalId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const scope = { serverProfileId, databaseId: '', principalId };
  if (!await ownsReminderScope(scope)) return;
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of existing) {
    if (!await ownsReminderScope(scope)) return;
    if (item.content.data?.source === NOTIFICATION_SOURCE
      && item.content.data?.serverProfileId === serverProfileId
      && item.content.data?.principalId !== principalId) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  }
}

async function ownsReminderScope(scope: NotificationScope): Promise<boolean> {
  if (!scope.principalId) return false; // Unowned legacy reminders must not execute.
  const tokens = await new SecureProfileTokenStore().load(scope.serverProfileId);
  return Boolean(tokens.accessToken && tokens.principalId === scope.principalId);
}

export async function scheduleLocalBillReminders(
  bills: Bill[],
  options: { scope: NotificationScope; showAmounts?: boolean; horizonDays?: number; now?: Date },
): Promise<number> {
  if (Platform.OS === 'web') return 0;
  if (!await ownsReminderScope(options.scope)) return 0;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return 0;

  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter((notification) => (
        notification.content.data?.source === NOTIFICATION_SOURCE
        && notification.content.data?.serverProfileId === options.scope.serverProfileId
        && notification.content.data?.databaseId === options.scope.databaseId
        && notification.content.data?.principalId === options.scope.principalId
      ))
      .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)),
  );

  const reminders = buildReminderSchedule(
    bills,
    options.now ?? new Date(),
    options.horizonDays ?? 60,
  );

  const scheduledIds = await Promise.all(
    reminders.map(async (reminder) => {
      if (!await ownsReminderScope(options.scope)) return null;
      const dueLabel =
        reminder.daysBefore === 0
          ? reminder.billType === 'deposit'
            ? i18n.t('mobileCore.notifications.expectedToday')
            : i18n.t('mobileCore.notifications.dueToday')
          : i18n.t('mobileCore.notifications.daysAway', { count: reminder.daysBefore });
      const amountLabel = options.showAmounts && reminder.amount != null
        ? ` • ${formatCurrency(reminder.amount)}`
        : '';

      return Notifications.scheduleNotificationAsync({
        identifier: `${options.scope.serverProfileId}:${options.scope.principalId ? `${options.scope.principalId}:` : ''}${options.scope.databaseId}:${reminder.id}`,
        content: {
          title: reminder.billName,
          body: `${dueLabel}${amountLabel}`,
          categoryIdentifier: BILL_REMINDER_CATEGORY,
          sound: 'default',
          data: {
            source: NOTIFICATION_SOURCE,
            billId: reminder.billId,
            serverProfileId: options.scope.serverProfileId,
            databaseId: options.scope.databaseId,
            ...(options.scope.principalId ? { principalId: options.scope.principalId } : {}),
            dueDate: reminder.dueDate,
            url: `billmanager://bills/${reminder.billId}`,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.notifyAt,
          channelId: BILL_REMINDER_CHANNEL,
        },
      });
    }),
  );

  if (!await ownsReminderScope(options.scope)) {
    await Promise.all(scheduledIds.filter((id): id is string => Boolean(id))
      .map((id) => Notifications.cancelScheduledNotificationAsync(id)));
    return 0;
  }
  return scheduledIds.filter(Boolean).length;
}
