import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  History,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
} from 'lucide-react-native';
import { LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import AdaptiveHeader from '../../components/adaptive/AdaptiveHeader';
import AdaptiveListRow from '../../components/adaptive/AdaptiveListRow';
import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import BucketPicker from '../../components/adaptive/BucketPicker';
import MoneyText from '../../components/adaptive/MoneyText';
import PreviewLineChart from '../../components/adaptive/PreviewLineChart';
import SectionHeader from '../../components/adaptive/SectionHeader';
import SegmentedControl from '../../components/adaptive/SegmentedControl';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveLayout } from '../../design/useAdaptiveLayout';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import type { Bill, BillFrequency } from '../../types';
import { summarizeCashFlowWindow } from '../cashFlowProjection';
import type { PreviewBill } from '../previewData';
import { useBillPresentation } from '../useBillPresentation';

type InsightRange = '6m' | '12m' | 'year';

function frequencyFromCadence(cadence: string): BillFrequency {
  const normalized = cadence.toLowerCase();
  if (normalized.includes('bi')) return 'bi-weekly';
  if (normalized.includes('week')) return 'weekly';
  if (normalized.includes('quarter')) return 'quarterly';
  if (normalized.includes('year') || normalized.includes('annual')) return 'yearly';
  if (normalized.includes('once')) return 'once';
  return 'monthly';
}

function scheduledBill(bill: PreviewBill, index: number): Bill | null {
  if (bill.source) return bill.source;
  if (!bill.dueDate) return null;
  return {
    id: Number(bill.id) || index + 1,
    name: bill.name,
    amount: bill.amount,
    varies: false,
    frequency: frequencyFromCadence(bill.cadence),
    frequency_type: 'simple',
    frequency_config: '{}',
    next_due: bill.dueDate,
    auto_payment: false,
    icon: bill.icon,
    type: bill.tone === 'income' ? 'deposit' : 'expense',
    account: bill.account,
    category: bill.category,
    notes: null,
    archived: false,
    is_shared: false,
  };
}

interface InsightsHomeScreenViewProps {
  platform: AdaptivePlatform;
}

export function InsightsHomeScreenView({ platform }: InsightsHomeScreenViewProps) {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const layout = useAdaptiveLayout();
  const {
    bills,
    groupOptions,
    selectedGroup,
    selectGroup,
    payments,
  } = useBillPresentation();
  const [showBuckets, setShowBuckets] = useState(false);
  const [range, setRange] = useState<InsightRange>('6m');
  const [chartWidth, setChartWidth] = useState(Math.max(300, layout.contentWidth - 60));
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const snapshot = useMemo(() => summarizeCashFlowWindow({
    bills: bills.flatMap((bill, index) => {
      const scheduled = scheduledBill(bill, index);
      return scheduled ? [scheduled] : [];
    }),
    payments,
    range,
    today: new Date(),
  }), [bills, payments, range, todayKey]);
  const incomeShare = snapshot.income > 0 ? Math.round((snapshot.net / snapshot.income) * 100) : 0;
  const rangeLabel = range === '6m'
    ? t('mobileCore.insights.nextSixMonths')
    : range === '12m'
      ? t('mobileCore.insights.nextTwelveMonths')
      : String(today.getFullYear());
  const rangeCaption = range === '6m'
    ? t('mobileCore.insights.captionSix')
    : range === '12m'
      ? t('mobileCore.insights.captionTwelve')
      : t('mobileCore.insights.captionYear', { year: today.getFullYear() });

  const handleChartLayout = (event: LayoutChangeEvent) => {
    setChartWidth(Math.max(260, event.nativeEvent.layout.width - 24));
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {platform === 'android' ? (
        <AdaptiveHeader
          title={t('mobileCore.insights.title')}
          groupName={selectedGroup}
          notificationCount={bills.filter((bill) => bill.source?.reminder_enabled).length}
          onPressGroup={() => setShowBuckets(true)}
          onPressNotifications={() => navigation.navigate('ReminderInbox')}
        />
      ) : null}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: layout.horizontalPadding, paddingBottom: 44 },
        ]}
      >
        <View style={[styles.content, { maxWidth: theme.contentMaxWidth }]}>
          <View>
            <Text accessibilityRole="header" style={[typography.title, { color: theme.colors.text }]}>{t('mobileCore.insights.financialOutlook')}</Text>
            <Text style={[typography.body, { color: theme.colors.textMuted }]}>{t('mobileCore.insights.outlookDetail', { group: selectedGroup })}</Text>
          </View>

          <SegmentedControl
            platform={platform}
            label={t('mobileCore.insights.range')}
            value={range}
            onChange={setRange}
            options={[
              { value: '6m', label: t('mobileCore.insights.sixMonths') },
              { value: '12m', label: t('mobileCore.insights.twelveMonths') },
              { value: 'year', label: t('mobileCore.insights.yearly') },
            ]}
          />
          <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{rangeCaption}</Text>

          <View style={[styles.metricGrid, layout.isTablet && styles.metricGridTablet]}>
            <AdaptiveSurface style={[styles.metric, { backgroundColor: theme.colors.primaryContainer }]}>
              <View style={styles.metricLabel}>
                <TrendingUp size={18} color={theme.colors.primary} />
                <Text style={[typography.caption, { color: theme.colors.primary }]}>{t('mobileCore.insights.income')}</Text>
              </View>
              <MoneyText platform={platform} amount={snapshot.income} style={styles.metricAmount} />
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileCore.insights.scheduledDeposits')}</Text>
            </AdaptiveSurface>
            <AdaptiveSurface style={[styles.metric, { backgroundColor: theme.colors.accentContainer }]}>
              <View style={styles.metricLabel}>
                <TrendingDown size={18} color={theme.colors.accent} />
                <Text style={[typography.caption, { color: theme.colors.accent }]}>{t('mobileCore.insights.bills')}</Text>
              </View>
              <MoneyText platform={platform} amount={snapshot.expenses} style={styles.metricAmount} />
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileCore.insights.scheduledExpenses')}</Text>
            </AdaptiveSurface>
            <AdaptiveSurface style={[styles.metric, !layout.isTablet && styles.metricFull]}>
              <View style={styles.metricLabel}>
                <WalletCards size={18} color={theme.colors.primary} />
                <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileCore.insights.netCashFlow')}</Text>
              </View>
              <MoneyText platform={platform} amount={snapshot.net} signed tone={snapshot.net >= 0 ? 'income' : 'expense'} style={styles.metricAmount} />
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>
                {snapshot.income > 0
                  ? t('mobileCore.insights.percentOfIncome', { percent: incomeShare })
                  : t('mobileCore.insights.addDeposits')}
              </Text>
            </AdaptiveSurface>
          </View>

          <SectionHeader
            platform={platform}
            title={t('mobileCore.insights.forecast')}
            actionLabel={t('mobileCore.insights.fullAnalytics')}
            onAction={() => navigation.navigate('Stats')}
          />
          <AdaptiveSurface style={styles.chartCard}>
            <View style={styles.chartHeadline}>
              <View>
                <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileCore.insights.projectedBalance')}</Text>
                <MoneyText platform={platform} amount={snapshot.net} signed tone={snapshot.net >= 0 ? 'income' : 'expense'} style={styles.chartAmount} />
              </View>
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{rangeLabel}</Text>
            </View>
            <View onLayout={handleChartLayout}>
              <PreviewLineChart platform={platform} width={chartWidth} values={snapshot.forecast} />
            </View>
          </AdaptiveSurface>

          <SectionHeader platform={platform} title={t('mobileCore.insights.explore')} />
          <AdaptiveSurface>
            <AdaptiveListRow
              platform={platform}
              title={t('mobileCore.insights.paymentHistory')}
              subtitle={t('mobileCore.insights.paymentHistoryDetail')}
              leading={<View style={[styles.actionIcon, { backgroundColor: theme.colors.surfaceMuted }]}><History size={22} color={theme.colors.primary} /></View>}
              onPress={() => navigation.navigate('PaymentHistory')}
            />
            <AdaptiveListRow
              platform={platform}
              title={t('mobileCore.insights.analytics')}
              subtitle={t('mobileCore.insights.analyticsDetail')}
              leading={<View style={[styles.actionIcon, { backgroundColor: theme.colors.surfaceMuted }]}><BarChart3 size={22} color={theme.colors.primary} /></View>}
              onPress={() => navigation.navigate('Stats')}
            />
            <AdaptiveListRow
              platform={platform}
              title={t('mobileCore.insights.sharedBills')}
              subtitle={t('mobileCore.insights.sharedBillsDetail')}
              leading={<View style={[styles.actionIcon, { backgroundColor: theme.colors.surfaceMuted }]}><Users size={22} color={theme.colors.primary} /></View>}
              onPress={() => navigation.navigate('Collaboration')}
            />
            <AdaptiveListRow
              platform={platform}
              title={t('mobileCore.insights.settlements')}
              subtitle={t('mobileCore.insights.settlementsDetail')}
              leading={<View style={[styles.actionIcon, { backgroundColor: theme.colors.surfaceMuted }]}><ArrowLeftRight size={22} color={theme.colors.primary} /></View>}
              onPress={() => navigation.navigate('Settlements')}
              isLast
            />
          </AdaptiveSurface>
        </View>
      </ScrollView>

      <BucketPicker
        platform={platform}
        visible={showBuckets}
        selected={selectedGroup}
        options={groupOptions}
        onSelect={(value) => void selectGroup(value)}
        onClose={() => setShowBuckets(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { paddingTop: 20 },
  content: { width: '100%', alignSelf: 'center', gap: 16 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricGridTablet: { flexWrap: 'nowrap' },
  metric: { minWidth: 0, flexGrow: 1, flexBasis: '46%', padding: 16, gap: 5 },
  metricFull: { flexBasis: '100%' },
  metricLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metricAmount: { fontSize: 23, lineHeight: 29, fontWeight: '800' },
  chartCard: { paddingTop: 16 },
  chartHeadline: { paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  chartAmount: { marginTop: 2, fontSize: 25, lineHeight: 31, fontWeight: '800' },
  actionIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
