import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, Bolt, CalendarClock, Check, CheckCircle2, Film } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import MoneyText from '../../components/adaptive/MoneyText';
import { useAuth } from '../../context/AuthContext';
import { useServerProfiles } from '../../context/ServerProfileContext';
import { MobileCacheRepository, type ReminderState } from '../../data/cacheRepository';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveLayout } from '../../design/useAdaptiveLayout';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import { buildReminderSchedule } from '../../native/reminderSchedule';
import { snoozeLocalBillReminder } from '../../native/localNotifications';
import type { PreviewBill } from '../previewData';
import { useBillPresentation } from '../useBillPresentation';

interface Reminder {
  id: string;
  billName: string;
  amount: number;
  timing: string;
  snoozed?: boolean;
  bill: PreviewBill;
  dueDate: string;
}

const cacheRepository = new MobileCacheRepository();

export function ReminderInboxScreenView({ platform }: { platform: AdaptivePlatform }) {
  const navigation = useNavigation<any>();
  const theme = useAdaptiveTheme(platform);
  const { t } = useTranslation();
  const layout = useAdaptiveLayout();
  const { bills, recordPayment } = useBillPresentation();
  const { user, currentDatabase } = useAuth();
  const { activeProfile } = useServerProfiles();
  const scope = useMemo(() => ({
    serverProfileId: activeProfile.id,
    databaseId: currentDatabase ?? '',
    principalId: user ? String(user.id) : undefined,
  }), [activeProfile.id, currentDatabase, user]);
  const [reminderStates, setReminderStates] = useState<ReminderState[]>([]);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const stateByBill = useMemo(
    () => new Map(reminderStates.map((state) => [state.billId, state])),
    [reminderStates],
  );
  const reminders: Reminder[] = useMemo(() => {
    const previewById = new Map(bills.map((bill) => [bill.id, bill]));
    const firstByBill = new Map<number, ReturnType<typeof buildReminderSchedule>[number]>();
    buildReminderSchedule(bills.flatMap((bill) => bill.source ? [bill.source] : []), new Date(), 60)
      .forEach((scheduled) => {
        if (!firstByBill.has(scheduled.billId)) firstByBill.set(scheduled.billId, scheduled);
      });
    return [...firstByBill.values()].flatMap((scheduled) => {
      const bill = previewById.get(String(scheduled.billId));
      if (!bill) return [];
      const state = stateByBill.get(String(scheduled.billId));
      if (state?.dismissedDueDate === scheduled.dueDate) return [];
      const snoozed = Boolean(state?.snoozedUntil && new Date(state.snoozedUntil) > new Date());
      return [{
        id: `${scheduled.billId}:${scheduled.dueDate}`,
        billName: bill.name,
        amount: bill.amount,
        timing: snoozed ? t('mobileCore.reminders.snoozedTiming') : bill.dueLabel,
        snoozed,
        bill,
        dueDate: scheduled.dueDate,
      }];
    }).slice(0, 20);
  }, [bills, stateByBill, t]);

  useEffect(() => {
    let active = true;
    if (!scope.databaseId) return () => { active = false; };
    void cacheRepository.getReminderStates(scope).then((states) => {
      if (active) setReminderStates(states);
    });
    return () => { active = false; };
  }, [scope]);

  const saveReminderState = async (state: ReminderState) => {
    await cacheRepository.putReminderState(scope, state);
    setReminderStates((states) => [...states.filter((item) => item.billId !== state.billId), state]);
  };

  const markPaid = async (reminder: Reminder) => {
    if (!reminder.bill.source) return;
    const previous = stateByBill.get(reminder.bill.id);
    await saveReminderState({
      billId: reminder.bill.id,
      notificationIds: previous?.notificationIds ?? [],
      nextScheduledAt: null,
      snoozedUntil: null,
      dismissedDueDate: reminder.dueDate,
      updatedAt: new Date().toISOString(),
    });
    setLastAction(t('mobileCore.reminders.markedPaid', { name: reminder.billName }));
    try {
      await recordPayment({ bill: reminder.bill.source });
    } catch {
      await saveReminderState({
        billId: reminder.bill.id,
        notificationIds: previous?.notificationIds ?? [],
        nextScheduledAt: previous?.nextScheduledAt ?? null,
        snoozedUntil: previous?.snoozedUntil ?? null,
        dismissedDueDate: previous?.dismissedDueDate ?? null,
        updatedAt: new Date().toISOString(),
      });
      setLastAction(t('mobileCore.reminders.markFailed', { name: reminder.billName }));
    }
  };

  const snooze = async (reminder: Reminder) => {
    if (!reminder.bill.source) return;
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const notificationId = await snoozeLocalBillReminder(reminder.bill.source, scope, until);
    const previous = stateByBill.get(reminder.bill.id);
    await saveReminderState({
      billId: reminder.bill.id,
      notificationIds: [...new Set([...(previous?.notificationIds ?? []), ...(notificationId ? [notificationId] : [])])],
      nextScheduledAt: until.toISOString(),
      snoozedUntil: until.toISOString(),
      dismissedDueDate: previous?.dismissedDueDate ?? null,
      updatedAt: new Date().toISOString(),
    });
    setLastAction(t('mobileCore.reminders.snoozed', { name: reminder.billName }));
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: layout.horizontalPadding },
        ]}
      >
        <View style={[styles.content, { maxWidth: 760 }]}>
          <View style={[styles.introIcon, { backgroundColor: theme.colors.primaryContainer }]}>
            <BellRing size={28} color={theme.colors.primary} />
          </View>
          <View style={styles.introCopy}>
            <Text accessibilityRole="header" style={[typography.title, { color: theme.colors.text }]}>{t('mobileCore.reminders.title')}</Text>
            <Text style={[typography.body, { color: theme.colors.textMuted }]}>{t('mobileCore.reminders.intro')}</Text>
          </View>

          {lastAction ? (
            <View accessibilityRole="alert" style={[styles.actionBanner, { backgroundColor: theme.colors.primaryContainer }]}>
              <Check size={18} color={theme.colors.primary} />
              <Text style={[typography.callout, { color: theme.colors.primary }]}>{lastAction}</Text>
            </View>
          ) : null}

          {reminders.length > 0 ? reminders.map((reminder) => (
            <AdaptiveSurface key={reminder.id} style={styles.reminderCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobileCore.reminders.openA11y', { name: reminder.billName })}
                onPress={() => navigation.getParent()?.navigate('BillsTab', {
                  screen: 'BillDetail',
                  params: { billId: Number(reminder.bill.id) },
                })}
                style={({ pressed }) => [styles.reminderHeader, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={[styles.billIcon, { backgroundColor: reminder.bill.icon === 'electric' ? theme.colors.accentContainer : theme.colors.surfaceMuted }]}>
                  {reminder.bill.icon === 'electric'
                    ? <Bolt size={24} color={theme.colors.accent} fill={theme.colors.accent} />
                    : <Film size={23} color={theme.colors.primary} />}
                </View>
                <View style={styles.reminderCopy}>
                  <Text style={[typography.section, { color: theme.colors.text }]}>{reminder.billName}</Text>
                  <View style={styles.timingRow}>
                    <CalendarClock size={15} color={theme.colors.textMuted} />
                    <Text style={[typography.caption, { color: reminder.snoozed ? theme.colors.primary : theme.colors.accent }]}>{reminder.timing}</Text>
                  </View>
                </View>
                <MoneyText platform={platform} amount={reminder.amount} tone="expense" style={styles.amount} />
              </Pressable>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('mobileCore.reminders.snoozeA11y', { name: reminder.billName })}
                  disabled={reminder.snoozed}
                  onPress={() => void snooze(reminder)}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    {
                      minHeight: theme.minimumHitSize,
                      borderColor: theme.colors.border,
                      opacity: reminder.snoozed ? 0.45 : pressed ? 0.62 : 1,
                    },
                  ]}
                >
                  <Text style={[typography.callout, { color: theme.colors.primary }]}>{t('mobileCore.reminders.snooze')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('mobileCore.reminders.markPaidA11y', { name: reminder.billName })}
                  onPress={() => void markPaid(reminder)}
                  style={({ pressed }) => [
                    styles.primaryAction,
                    {
                      minHeight: theme.minimumHitSize,
                      backgroundColor: theme.colors.primary,
                      borderRadius: platform === 'ios' ? 12 : 16,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <CheckCircle2 size={19} color={theme.colors.onPrimary} />
                  <Text style={[typography.callout, { color: theme.colors.onPrimary, fontWeight: '700' }]}>{t('mobileCore.reminders.markPaid')}</Text>
                </Pressable>
              </View>
            </AdaptiveSurface>
          )) : (
            <AdaptiveSurface style={styles.emptyState}>
              <CheckCircle2 size={36} color={theme.colors.success} />
              <Text style={[typography.section, { color: theme.colors.text }]}>{t('mobileCore.reminders.caughtUp')}</Text>
              <Text style={[typography.body, styles.emptyCopy, { color: theme.colors.textMuted }]}>{t('mobileCore.reminders.caughtUpDetail')}</Text>
            </AdaptiveSurface>
          )}

          <Text style={[typography.caption, styles.disclaimer, { color: theme.colors.textMuted }]}>
            {t('mobileCore.reminders.disclaimer')}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { paddingTop: 20, paddingBottom: 40 },
  content: { width: '100%', alignSelf: 'center', gap: 16 },
  introIcon: { width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  introCopy: { gap: 3 },
  actionBanner: { minHeight: 48, padding: 13, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  reminderCard: { padding: 16, gap: 16 },
  reminderHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  billIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  reminderCopy: { minWidth: 0, flex: 1, gap: 4 },
  timingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  amount: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10 },
  secondaryAction: { flex: 0.8, borderWidth: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryAction: { flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  emptyState: { minHeight: 250, padding: 30, alignItems: 'center', justifyContent: 'center', gap: 9 },
  emptyCopy: { textAlign: 'center' },
  disclaimer: { textAlign: 'center', marginTop: 4 },
});
