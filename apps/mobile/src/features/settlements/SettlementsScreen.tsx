import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, Clock3, Users } from 'lucide-react-native';

import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import MoneyText from '../../components/adaptive/MoneyText';
import SectionHeader from '../../components/adaptive/SectionHeader';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveLayout } from '../../design/useAdaptiveLayout';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import { SettlementPersonRollup, SettlementsActions, SettlementsViewModel } from './models';
import { useTranslation } from 'react-i18next';

export interface SettlementsScreenProps {
  model: SettlementsViewModel;
  actions: SettlementsActions;
  platform?: AdaptivePlatform;
}

function money(value: number, model: Pick<SettlementsViewModel, 'locale' | 'currency'>): string {
  return new Intl.NumberFormat(model.locale, { style: 'currency', currency: model.currency }).format(value);
}

function StatusPanel({ platform, title, body, loading, onRetry }: { platform: AdaptivePlatform; title: string; body: string; loading?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  return (
    <View style={[styles.state, { backgroundColor: theme.colors.background }]}>
      {loading ? <ActivityIndicator accessibilityLabel={t('mobileParity.settlements.loadingTitle')} size="large" color={theme.colors.primary} /> : null}
      <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{body}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, { minHeight: theme.minimumHitSize, backgroundColor: theme.colors.primary, opacity: pressed ? 0.65 : 1 }]}>
          <Text style={[typography.headline, { color: theme.colors.onPrimary }]}>{t('mobileParity.common.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PersonRow({ person, model, actions, platform, isLast }: { person: SettlementPersonRollup; model: SettlementsViewModel; actions: SettlementsActions; platform: AdaptivePlatform; isLast: boolean }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const owesYou = person.direction === 'owes-you';
  const settled = person.direction === 'settled';
  const directionText = settled ? t('mobileParity.settlements.settled') : owesYou ? t('mobileParity.settlements.owesYou') : t('mobileParity.settlements.youOwe');
  return (
    <View style={[styles.personRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('mobileParity.settlements.personA11y', { name: person.displayName, direction: directionText, amount: money(Math.abs(person.balance), model), bills: t('mobileParity.settlements.sharedBills', { count: person.sharedBillCount }), activity: person.lastActivityLabel, pending: person.pendingSync ? `, ${t('mobileParity.common.pendingSync')}` : '' })}
        onPress={() => actions.onOpenPerson(person.userId)}
        style={({ pressed }) => [styles.personMain, { opacity: pressed ? 0.55 : 1 }]}
      >
        <View style={[styles.avatar, { backgroundColor: settled ? theme.colors.surfaceMuted : owesYou ? theme.colors.primaryContainer : theme.colors.accentContainer }]}>
          {settled ? <Check size={21} color={theme.colors.success} /> : owesYou ? <ArrowDownLeft size={21} color={theme.colors.primary} /> : <ArrowUpRight size={21} color={theme.colors.accent} />}
        </View>
        <View style={styles.personCopy}>
          <Text numberOfLines={1} style={[typography.headline, { color: theme.colors.text }]}>{person.displayName}</Text>
          <Text numberOfLines={1} style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.settlements.sharedBills', { count: person.sharedBillCount })} · {person.lastActivityLabel}</Text>
        </View>
        <View style={styles.balanceColumn}>
          <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{directionText}</Text>
          <MoneyText platform={platform} amount={Math.abs(person.balance)} tone={settled ? 'default' : owesYou ? 'income' : 'expense'} style={styles.personAmount} />
        </View>
        <ChevronRight size={19} color={theme.colors.textMuted} />
      </Pressable>
      {person.canMarkPaid ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobileParity.settlements.markBalanceA11y', { name: person.displayName })}
          accessibilityState={{ disabled: model.offline || model.actionBusy, busy: model.actionBusy }}
          accessibilityHint={model.offline ? t('mobileParity.settlements.connectHint') : t('mobileParity.settlements.markHint')}
          disabled={model.offline || model.actionBusy}
          onPress={() => actions.onMarkPaid(person.userId)}
          style={({ pressed }) => [
            styles.markPaid,
            {
              minHeight: theme.minimumHitSize,
              borderColor: theme.colors.border,
              opacity: model.offline || model.actionBusy ? 0.42 : pressed ? 0.56 : 1,
            },
          ]}
        >
          <Check size={18} color={theme.colors.primary} />
          <Text style={[typography.callout, { color: theme.colors.primary }]}>{t('settlementsPage.markPaidButton')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function SettlementsScreen({ model, actions, platform = Platform.OS === 'ios' ? 'ios' : 'android' }: SettlementsScreenProps) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const layout = useAdaptiveLayout();

  if (model.status === 'loading') return <StatusPanel platform={platform} title={t('mobileParity.settlements.loadingTitle')} body={t('mobileParity.settlements.loadingBody')} loading />;
  if (model.status === 'error') return <StatusPanel platform={platform} title={t('mobileParity.settlements.unavailableTitle')} body={model.errorMessage ?? t('mobileParity.settlements.unavailableBody')} onRetry={actions.onRetry} />;
  if (model.status === 'permission-denied') return <StatusPanel platform={platform} title={t('mobileParity.settlements.restrictedTitle')} body={model.permissionMessage ?? t('mobileParity.settlements.restrictedBody')} />;

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={Boolean(model.refreshing)} onRefresh={actions.onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
        contentContainerStyle={[styles.content, { paddingHorizontal: layout.horizontalPadding, maxWidth: theme.contentMaxWidth }]}
      >
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[typography.title, { color: theme.colors.text }]}>{t('settlementsPage.title')}</Text>
          <Text style={[typography.body, { color: theme.colors.textMuted }]}>{t('mobileParity.settlements.subtitle', { bucket: model.bucketLabel })}</Text>
        </View>

        {model.offline ? (
          <View accessibilityRole="alert" style={[styles.offline, { backgroundColor: theme.colors.accentContainer }]}>
            <Text style={[typography.callout, { color: theme.colors.accent }]}>{t('mobileParity.settlements.offlineSaved', { updated: model.lastUpdatedLabel ? ` · ${model.lastUpdatedLabel}` : '' })}</Text>
          </View>
        ) : null}

        <AdaptiveSurface
          accessibilityLabel={t('mobileParity.settlements.summaryA11y', { owed: money(model.summary.owedToYou, model), owe: money(model.summary.youOwe, model), net: money(model.summary.net, model) })}
          style={styles.summary}
        >
          <View style={styles.netBlock}>
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('settlementsPage.netBalance')}</Text>
            <MoneyText platform={platform} amount={model.summary.net} signed tone={model.summary.net >= 0 ? 'income' : 'expense'} style={styles.netAmount} />
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.settlements.outstanding', { count: model.summary.outstandingPeople })}</Text>
          </View>
          <View style={styles.summarySides}>
            <View style={styles.summarySide}>
              <ArrowDownLeft size={18} color={theme.colors.success} />
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('settlementsPage.owedToMe')}</Text>
              <MoneyText platform={platform} amount={model.summary.owedToYou} tone="income" style={styles.sideAmount} />
            </View>
            <View style={styles.summarySide}>
              <ArrowUpRight size={18} color={theme.colors.accent} />
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('settlementsPage.iOwe')}</Text>
              <MoneyText platform={platform} amount={model.summary.youOwe} tone="expense" style={styles.sideAmount} />
            </View>
          </View>
        </AdaptiveSurface>

        <SectionHeader platform={platform} title={t('mobileParity.settlements.people')} />
        {model.people.length === 0 ? (
          <AdaptiveSurface style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primaryContainer }]}><Users size={25} color={theme.colors.primary} /></View>
            <Text accessibilityRole="header" style={[typography.headline, { color: theme.colors.text }]}>{t('mobileParity.settlements.everyoneSettled')}</Text>
            <Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{t('mobileParity.settlements.everyoneSettledBody')}</Text>
          </AdaptiveSurface>
        ) : (
          <AdaptiveSurface>
            {model.people.map((person, index) => <PersonRow key={person.userId} person={person} model={model} actions={actions} platform={platform} isLast={index === model.people.length - 1} />)}
          </AdaptiveSurface>
        )}

        <SectionHeader platform={platform} title={t('mobileParity.settlements.recent')} actionLabel={t('mobileParity.settlements.viewAll')} onAction={actions.onOpenHistory} />
        {model.recentHistory.length === 0 ? (
          <Text style={[typography.body, styles.historyEmpty, { color: theme.colors.textMuted }]}>{t('mobileParity.settlements.noHistory')}</Text>
        ) : (
          <AdaptiveSurface>
            {model.recentHistory.map((item, index) => (
              <View key={item.id} accessible accessibilityLabel={t('mobileParity.settlements.paidA11y', { payer: item.payerName, payee: item.payeeName, amount: money(item.amount, model), date: item.settledAtLabel })} style={[styles.historyRow, index < model.recentHistory.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }]}>
                <View style={[styles.historyIcon, { backgroundColor: theme.colors.surfaceMuted }]}><Clock3 size={19} color={theme.colors.primary} /></View>
                <View style={styles.historyCopy}>
                  <Text numberOfLines={1} style={[typography.callout, { color: theme.colors.text }]}>{t('mobileParity.settlements.paid', { payer: item.payerName, payee: item.payeeName })}</Text>
                  <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{item.settledAtLabel}</Text>
                </View>
                <MoneyText platform={platform} amount={item.amount} style={styles.historyAmount} />
              </View>
            ))}
          </AdaptiveSurface>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  state: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centered: { textAlign: 'center', maxWidth: 460 },
  retry: { marginTop: 8, borderRadius: 14, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', alignSelf: 'center', paddingTop: 20, paddingBottom: 52, gap: 14 },
  heading: { gap: 3 },
  offline: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  summary: { padding: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 22 },
  netBlock: { minWidth: 190, flex: 1, gap: 3 },
  netAmount: { fontSize: 31, lineHeight: 37, fontWeight: '800' },
  summarySides: { flexDirection: 'row', gap: 20 },
  summarySide: { alignItems: 'flex-end', gap: 2 },
  sideAmount: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  personRow: { padding: 12, gap: 4 },
  personMain: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  personCopy: { minWidth: 0, flex: 1, gap: 2 },
  balanceColumn: { alignItems: 'flex-end', gap: 1 },
  personAmount: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  markPaid: { alignSelf: 'flex-end', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  empty: { padding: 28, alignItems: 'center', gap: 7 },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  historyEmpty: { paddingVertical: 12, textAlign: 'center' },
  historyRow: { minHeight: 64, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  historyCopy: { minWidth: 0, flex: 1, gap: 2 },
  historyAmount: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
});
