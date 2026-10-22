import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  CalendarDays,
  CircleDollarSign,
  Landmark,
  TrendingDown,
  TrendingUp,
} from 'lucide-react-native';

import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import MoneyText from '../../components/adaptive/MoneyText';
import SectionHeader from '../../components/adaptive/SectionHeader';
import SegmentedControl from '../../components/adaptive/SegmentedControl';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveLayout } from '../../design/useAdaptiveLayout';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import {
  AnalyticsActions,
  AnalyticsBreakdownItem,
  AnalyticsViewModel,
} from './models';
import { useTranslation } from 'react-i18next';

export interface AnalyticsScreenProps {
  model: AnalyticsViewModel;
  actions: AnalyticsActions;
  platform?: AdaptivePlatform;
}

function formatMoney(value: number, model: Pick<AnalyticsViewModel, 'locale' | 'currency'>): string {
  return new Intl.NumberFormat(model.locale, { style: 'currency', currency: model.currency }).format(value);
}

function StatusPanel({
  platform,
  heading,
  body,
  loading,
  onRetry,
}: {
  platform: AdaptivePlatform;
  heading: string;
  body: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  return (
    <View style={[styles.state, { backgroundColor: theme.colors.background }]}>
      {loading ? <ActivityIndicator size="large" color={theme.colors.primary} accessibilityLabel={t('mobileParity.analytics.loadingTitle')} /> : null}
      <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>{heading}</Text>
      <Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{body}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, { minHeight: theme.minimumHitSize, backgroundColor: theme.colors.primary, opacity: pressed ? 0.65 : 1 }]}>
          <Text style={[typography.headline, { color: theme.colors.onPrimary }]}>{t('mobileParity.common.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Breakdown({
  items,
  platform,
  model,
}: {
  items: AnalyticsBreakdownItem[];
  platform: AdaptivePlatform;
  model: AnalyticsViewModel;
}) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const maxAmount = Math.max(...items.map((item) => item.amount), 1);
  return (
    <View style={styles.breakdownList}>
      {items.map((item) => (
        <View
          key={item.id}
          accessible
          accessibilityLabel={t('mobileParity.analytics.breakdownA11y', { label: item.label, amount: formatMoney(item.amount, model), share: item.sharePercent.toFixed(1), change: item.changePercent === undefined ? '' : t('mobileParity.analytics.changeA11y', { direction: t(item.changePercent >= 0 ? 'mobileParity.analytics.up' : 'mobileParity.analytics.down'), value: Math.abs(item.changePercent).toFixed(1) }) })}
          style={styles.breakdownRow}
        >
          <View style={styles.breakdownLabelRow}>
            <Text numberOfLines={1} style={[typography.callout, styles.breakdownLabel, { color: theme.colors.text }]}>{item.label}</Text>
            <MoneyText platform={platform} amount={item.amount} style={styles.breakdownAmount} />
          </View>
          <View style={[styles.track, { backgroundColor: theme.colors.surfaceMuted }]}>
            <View style={[styles.fill, { width: `${Math.max(3, (item.amount / maxAmount) * 100)}%`, backgroundColor: item.color ?? theme.colors.primary }]} />
          </View>
          <View style={styles.breakdownMeta}>
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.shareOfTotal', { value: item.sharePercent.toFixed(1) })}</Text>
            {item.changePercent !== undefined ? (
              <Text style={[typography.caption, { color: item.changePercent <= 0 ? theme.colors.success : theme.colors.accent }]}>
                {t('mobileParity.analytics.priorPeriod', { value: `${item.changePercent > 0 ? '+' : ''}${item.changePercent.toFixed(1)}` })}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export default function AnalyticsScreen({
  model,
  actions,
  platform = Platform.OS === 'ios' ? 'ios' : 'android',
}: AnalyticsScreenProps) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const layout = useAdaptiveLayout();

  if (model.status === 'loading') return <StatusPanel platform={platform} heading={t('mobileParity.analytics.loadingTitle')} body={t('mobileParity.analytics.loadingBody')} loading />;
  if (model.status === 'error') return <StatusPanel platform={platform} heading={t('mobileParity.analytics.unavailableTitle')} body={model.errorMessage ?? t('mobileParity.analytics.unavailableBody')} onRetry={actions.onRetry} />;
  if (model.status === 'permission-denied') return <StatusPanel platform={platform} heading={t('mobileParity.analytics.restrictedTitle')} body={model.permissionMessage ?? t('mobileParity.analytics.restrictedBody')} />;

  const hasData = model.monthly.length > 0 || model.categories.length > 0 || model.cashFlow.length > 0;
  if (!hasData) {
    return <StatusPanel platform={platform} heading={t('mobileParity.analytics.notEnoughTitle')} body={t('mobileParity.analytics.notEnoughBody')} />;
  }

  const summaryTitle = model.range === 'year'
    ? t('mobileParity.analytics.annualSummary')
    : t('mobileParity.analytics.windowSummary');
  const rangeCaption = model.range === '6m'
    ? t('mobileParity.analytics.captionSix')
    : model.range === '12m'
      ? t('mobileParity.analytics.captionTwelve')
      : model.selectedYear < new Date().getFullYear()
        ? t('mobileParity.analytics.captionPastYear', { year: model.selectedYear })
        : model.selectedYear > new Date().getFullYear()
          ? t('mobileParity.analytics.captionFutureYear', { year: model.selectedYear })
          : t('mobileParity.analytics.captionYear', { year: model.selectedYear });
  const maxMonthly = Math.max(...model.monthly.flatMap((point) => [point.income, point.expenses]), 1);
  const annualLabel = t('mobileParity.analytics.annualA11y', { title: `${summaryTitle}. ${rangeCaption}`, income: formatMoney(model.annual.income, model), expenses: formatMoney(model.annual.expenses, model), net: formatMoney(model.annual.net, model), rate: model.annual.savingsRate.toFixed(1) });
  const cashFlowLabel = model.cashFlow.length === 0 ? t('mobileParity.analytics.noCashFlowA11y') : t('mobileParity.analytics.cashFlowA11y', { count: model.cashFlow.filter((point) => point.forecast).length, first: model.cashFlow[0].label, last: model.cashFlow[model.cashFlow.length - 1].label, start: formatMoney(model.cashFlow[0].endingBalance, model), end: formatMoney(model.cashFlow[model.cashFlow.length - 1].endingBalance, model) });

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={Boolean(model.refreshing)} onRefresh={actions.onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
        contentContainerStyle={[styles.content, { paddingHorizontal: layout.horizontalPadding, maxWidth: theme.contentMaxWidth }]}
      >
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" style={[typography.title, { color: theme.colors.text }]}>{t('analyticsPage.title')}</Text>
            <Text style={[typography.body, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.subtitle', { bucket: model.bucketLabel })}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileParity.analytics.yearA11y', { year: model.selectedYear })}
            onPress={actions.onOpenYearPicker}
            style={({ pressed }) => [styles.yearButton, { minHeight: theme.minimumHitSize, borderColor: theme.colors.border, opacity: pressed ? 0.55 : 1 }]}
          >
            <CalendarDays size={18} color={theme.colors.primary} />
            <Text style={[typography.callout, { color: theme.colors.text }]}>{model.selectedYear}</Text>
          </Pressable>
        </View>

        {model.offline ? (
          <View accessibilityRole="alert" style={[styles.offline, { backgroundColor: theme.colors.accentContainer }]}>
            <Text style={[typography.callout, { color: theme.colors.accent }]}>{t('mobileParity.analytics.offlineSaved', { updated: model.lastUpdatedLabel ? ` · ${model.lastUpdatedLabel}` : '' })}</Text>
          </View>
        ) : null}

        <SegmentedControl
          platform={platform}
          label={t('mobileParity.analytics.range')}
          value={model.range}
          onChange={actions.onChangeRange}
          options={[{ value: '6m', label: t('mobileParity.analytics.sixMonths') }, { value: '12m', label: t('mobileParity.analytics.twelveMonths') }, { value: 'year', label: t('mobileParity.analytics.year') }]}
        />
        <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{rangeCaption}</Text>

        <View style={styles.sectionHeading}>
          <SectionHeader platform={platform} title={summaryTitle} />
        </View>
        <AdaptiveSurface accessibilityLabel={annualLabel} style={styles.annualSurface}>
          <View style={styles.annualPrimary}>
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.netCashFlow')}</Text>
            <MoneyText platform={platform} amount={model.annual.net} signed tone={model.annual.net >= 0 ? 'income' : 'expense'} style={styles.heroAmount} />
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.savingsRate', { value: model.annual.savingsRate.toFixed(1) })}</Text>
          </View>
          <View style={styles.annualDetails}>
            <View>
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.common.income')}</Text>
              <MoneyText platform={platform} amount={model.annual.income} tone="income" style={styles.detailAmount} />
            </View>
            <View>
              <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.common.expenses')}</Text>
              <MoneyText platform={platform} amount={model.annual.expenses} tone="expense" style={styles.detailAmount} />
            </View>
          </View>
        </AdaptiveSurface>

        <View style={styles.sectionHeading}>
          <SectionHeader platform={platform} title={t('mobileParity.analytics.yearOverYear')} />
        </View>
        <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.recordedComparison')}</Text>
        <View
          accessible
          accessibilityLabel={t('mobileParity.analytics.yoyA11y', { current: model.yearOverYear.currentYear, previous: model.yearOverYear.previousYear, incomeDirection: t(model.yearOverYear.incomeChangePercent >= 0 ? 'mobileParity.analytics.up' : 'mobileParity.analytics.down'), incomeValue: Math.abs(model.yearOverYear.incomeChangePercent).toFixed(1), expenseDirection: t(model.yearOverYear.expenseChangePercent >= 0 ? 'mobileParity.analytics.up' : 'mobileParity.analytics.down'), expenseValue: Math.abs(model.yearOverYear.expenseChangePercent).toFixed(1), net: formatMoney(model.yearOverYear.netChange, model) })}
          style={[styles.comparisonRow, { borderColor: theme.colors.border }]}
        >
          <View style={styles.comparisonMetric}>
            <TrendingUp size={20} color={theme.colors.success} />
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.common.income')}</Text>
            <Text style={[typography.section, { color: theme.colors.success }]}>{model.yearOverYear.incomeChangePercent > 0 ? '+' : ''}{model.yearOverYear.incomeChangePercent.toFixed(1)}%</Text>
          </View>
          <View style={styles.comparisonMetric}>
            <TrendingDown size={20} color={theme.colors.accent} />
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.common.expenses')}</Text>
            <Text style={[typography.section, { color: theme.colors.accent }]}>{model.yearOverYear.expenseChangePercent > 0 ? '+' : ''}{model.yearOverYear.expenseChangePercent.toFixed(1)}%</Text>
          </View>
          <View style={styles.comparisonMetric}>
            <CircleDollarSign size={20} color={theme.colors.primary} />
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.netChange')}</Text>
            <MoneyText platform={platform} amount={model.yearOverYear.netChange} signed style={styles.comparisonAmount} />
          </View>
        </View>

        <View style={[layout.isTablet && styles.twoColumn, { gap: layout.columnGap }]}>
          <View style={styles.column}>
            <View style={styles.sectionHeading}>
              <SectionHeader platform={platform} title={t('mobileParity.analytics.categoryTrends')} />
            </View>
            <AdaptiveSurface style={styles.breakdownSurface}>
              {model.categories.length ? <Breakdown items={model.categories} platform={platform} model={model} /> : <Text style={[typography.body, styles.emptyText, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.noCategorized')}</Text>}
            </AdaptiveSurface>
          </View>
          <View style={styles.column}>
            <View style={styles.sectionHeading}>
              <SectionHeader platform={platform} title={t('mobileParity.analytics.byAccount')} />
            </View>
            <AdaptiveSurface style={styles.breakdownSurface}>
              {model.accounts.length ? <Breakdown items={model.accounts} platform={platform} model={model} /> : <Text style={[typography.body, styles.emptyText, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.noAccounts')}</Text>}
            </AdaptiveSurface>
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <SectionHeader platform={platform} title={t('mobileParity.analytics.monthlyComparison')} />
        </View>
        <AdaptiveSurface
          style={styles.monthlySurface}
          accessibilityLabel={t('mobileParity.analytics.monthlyA11y', { summary: model.monthly.map((point) => t('mobileParity.analytics.monthlyPointA11y', { label: point.label, income: formatMoney(point.income, model), expenses: formatMoney(point.expenses, model), net: formatMoney(point.net, model) })).join('. ') })}
        >
          {model.monthly.map((point) => (
            <View key={point.key} style={styles.monthRow}>
              <Text style={[typography.caption, styles.monthLabel, { color: theme.colors.textSecondary }]}>{point.label}</Text>
              <View style={styles.monthBars}>
                <View style={[styles.monthBar, { width: `${Math.max(2, (point.income / maxMonthly) * 100)}%`, backgroundColor: theme.colors.primary }]} />
                <View style={[styles.monthBar, { width: `${Math.max(2, (point.expenses / maxMonthly) * 100)}%`, backgroundColor: theme.colors.accent }]} />
              </View>
              <MoneyText platform={platform} amount={point.net} signed tone={point.net >= 0 ? 'income' : 'expense'} style={styles.monthAmount} />
            </View>
          ))}
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.primary }]} /><Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.common.income')}</Text>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.accent }]} /><Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.common.expenses')}</Text>
          </View>
        </AdaptiveSurface>

        <View style={styles.sectionHeading}>
          <SectionHeader platform={platform} title={t('mobileParity.analytics.yearlyHistory')} />
        </View>
        <AdaptiveSurface accessibilityLabel={t('mobileParity.analytics.yearlyA11y', { summary: model.yearly.map((point) => t('mobileParity.analytics.yearlyPointA11y', { year: point.year, net: formatMoney(point.net, model) })).join('. ') })}>
          {model.yearly.map((point, index) => (
            <View key={point.year} style={[styles.yearRow, index < model.yearly.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }]}>
              <Text style={[typography.headline, { color: theme.colors.text }]}>{point.year}</Text>
              <View style={styles.yearMeta}>
                <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.in', { amount: formatMoney(point.income, model) })} · {t('mobileParity.analytics.out', { amount: formatMoney(point.expenses, model) })}</Text>
                <MoneyText platform={platform} amount={point.net} signed tone={point.net >= 0 ? 'income' : 'expense'} style={styles.yearAmount} />
              </View>
            </View>
          ))}
        </AdaptiveSurface>

        <View style={styles.sectionHeading}>
          <SectionHeader platform={platform} title={t('mobileParity.analytics.cashFlowForecast')} />
        </View>
        <AdaptiveSurface accessibilityLabel={cashFlowLabel} style={styles.forecastSurface}>
          <View style={styles.forecastHeading}>
            <View style={[styles.forecastIcon, { backgroundColor: theme.colors.primaryContainer }]}><Landmark size={22} color={theme.colors.primary} /></View>
            <Text style={[typography.body, styles.forecastCopy, { color: theme.colors.textSecondary }]}>{cashFlowLabel}</Text>
          </View>
          {model.cashFlow.map((point, index) => (
            <View key={point.key} style={styles.forecastRow}>
              <View style={[styles.timelineDot, { backgroundColor: point.forecast ? theme.colors.accent : theme.colors.primary }]} />
              {index < model.cashFlow.length - 1 ? <View style={[styles.timelineLine, { backgroundColor: theme.colors.border }]} /> : null}
              <View style={styles.forecastMeta}>
                <Text style={[typography.callout, { color: theme.colors.text }]}>{point.label}{point.forecast ? ` · ${t('mobileParity.analytics.forecast')}` : ''}</Text>
                <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.analytics.in', { amount: formatMoney(point.income, model) })} · {t('mobileParity.analytics.out', { amount: formatMoney(point.expenses, model) })}</Text>
              </View>
              <MoneyText platform={platform} amount={point.endingBalance} signed tone={point.endingBalance >= 0 ? 'income' : 'expense'} style={styles.forecastAmount} />
            </View>
          ))}
        </AdaptiveSurface>
      </ScrollView>
      <Modal
        visible={model.yearPickerVisible}
        transparent={platform !== 'ios'}
        animationType="slide"
        presentationStyle={platform === 'ios' ? 'pageSheet' : 'overFullScreen'}
        onRequestClose={actions.onCloseYearPicker}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobileParity.analytics.closeYearPicker')}
          onPress={actions.onCloseYearPicker}
          style={[styles.yearModalBackdrop, platform === 'ios' && styles.yearModalBackdropIos]}
        >
          <Pressable
            accessibilityRole="none"
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.yearModalSheet,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>
              {t('mobileParity.analytics.chooseYear')}
            </Text>
            <View style={styles.yearGrid}>
              {model.availableYears.map((year) => {
                const selected = year === model.selectedYear;
                return (
                  <Pressable
                    key={year}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t('mobileParity.analytics.yearA11y', { year })}
                    onPress={() => actions.onSelectYear(year)}
                    style={({ pressed }) => [
                      styles.yearChoice,
                      {
                        minHeight: theme.minimumHitSize,
                        backgroundColor: selected ? theme.colors.primaryContainer : theme.colors.surfaceMuted,
                        borderColor: selected ? theme.colors.primary : theme.colors.border,
                        opacity: pressed ? 0.62 : 1,
                      },
                    ]}
                  >
                    <Text style={[typography.headline, { color: selected ? theme.colors.primary : theme.colors.text }]}>
                      {year}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  state: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centered: { textAlign: 'center', maxWidth: 460 },
  retry: { marginTop: 8, borderRadius: 14, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', alignSelf: 'center', paddingTop: 20, paddingBottom: 52, gap: 14 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headingCopy: { minWidth: 0, flex: 1, gap: 3 },
  yearButton: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  offline: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  sectionHeading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  annualSurface: { padding: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 22 },
  annualPrimary: { minWidth: 190, flex: 1, gap: 3 },
  annualDetails: { flexDirection: 'row', gap: 24 },
  heroAmount: { fontSize: 31, lineHeight: 37, fontWeight: '800' },
  detailAmount: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  comparisonRow: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  comparisonMetric: { minWidth: 104, flex: 1, gap: 3 },
  comparisonAmount: { fontSize: 19, lineHeight: 25, fontWeight: '800' },
  twoColumn: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { minWidth: 0, flex: 1 },
  breakdownSurface: { padding: 16 },
  breakdownList: { gap: 16 },
  breakdownRow: { gap: 6 },
  breakdownLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  breakdownLabel: { minWidth: 0, flex: 1 },
  breakdownAmount: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  track: { height: 7, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  breakdownMeta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  emptyText: { textAlign: 'center', padding: 20 },
  monthlySurface: { padding: 16, gap: 12 },
  monthRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthLabel: { width: 44 },
  monthBars: { minWidth: 0, flex: 1, gap: 4 },
  monthBar: { height: 6, borderRadius: 999 },
  monthAmount: { width: 90, textAlign: 'right', fontSize: 14, lineHeight: 19, fontWeight: '700' },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  yearModalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  yearModalBackdropIos: { backgroundColor: 'transparent' },
  yearModalSheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 22,
    paddingBottom: 36,
    gap: 18,
  },
  yearGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  yearChoice: {
    minWidth: 92,
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  yearRow: { minHeight: 68, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  yearMeta: { minWidth: 0, flex: 1, alignItems: 'flex-end', gap: 2 },
  yearAmount: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  forecastSurface: { padding: 16, gap: 6 },
  forecastHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  forecastIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  forecastCopy: { minWidth: 0, flex: 1 },
  forecastRow: { minHeight: 62, paddingLeft: 30, flexDirection: 'row', alignItems: 'center', gap: 10, position: 'relative' },
  timelineDot: { position: 'absolute', left: 4, top: 24, width: 10, height: 10, borderRadius: 5 },
  timelineLine: { position: 'absolute', left: 8, top: 34, bottom: -28, width: 2 },
  forecastMeta: { minWidth: 0, flex: 1, gap: 2 },
  forecastAmount: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
});
