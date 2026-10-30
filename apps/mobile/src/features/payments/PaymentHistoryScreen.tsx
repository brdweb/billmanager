import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import {
  CalendarDays,
  ChevronDown,
  Download,
  CircleDollarSign,
  FileText,
  Pencil,
  Printer,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  WalletCards,
} from 'lucide-react-native';

import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import MoneyText from '../../components/adaptive/MoneyText';
import SegmentedControl from '../../components/adaptive/SegmentedControl';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveLayout } from '../../design/useAdaptiveLayout';
import { useAndroidTopInset } from '../../design/useAndroidTopInset';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import {
  PaymentExportFormat,
  PaymentFilterKind,
  PaymentHistoryActions,
  PaymentHistoryFilters,
  PaymentHistoryItem,
  PaymentHistoryViewModel,
  hasActivePaymentFilters,
  paymentSortLabel,
} from './models';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export interface PaymentHistoryScreenProps {
  model: PaymentHistoryViewModel;
  actions: PaymentHistoryActions;
  platform?: AdaptivePlatform;
  title?: string;
}

const exportActions: Array<{ format: PaymentExportFormat; label: string; icon: typeof Download }> = [
  { format: 'csv', label: 'CSV', icon: Download },
  { format: 'pdf', label: 'PDF', icon: FileText },
  { format: 'print', label: 'Print', icon: Printer },
  { format: 'share', label: 'Share', icon: Share2 },
];

function formatMoney(amount: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

function localizedSortLabel(t: TFunction, sort: Parameters<typeof paymentSortLabel>[0]): string {
  const keys = {
    date_desc: 'mobileParity.payments.sortNewest',
    date_asc: 'mobileParity.payments.sortOldest',
    amount_desc: 'mobileParity.payments.sortHighest',
    amount_asc: 'mobileParity.payments.sortLowest',
    bill_asc: 'mobileParity.payments.sortNameAsc',
    bill_desc: 'mobileParity.payments.sortNameDesc',
  } as const;
  return t(keys[sort]);
}

function StatusPanel({
  platform,
  title,
  message,
  loading = false,
  onRetry,
}: {
  platform: AdaptivePlatform;
  title: string;
  message: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  return (
    <View style={[styles.stateScreen, { backgroundColor: theme.colors.background }]}>
      {loading ? <ActivityIndicator accessibilityLabel={t('mobileParity.payments.loadingTitle')} color={theme.colors.primary} size="large" /> : null}
      <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[typography.body, styles.stateMessage, { color: theme.colors.textMuted }]}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.primaryButton,
            { minHeight: theme.minimumHitSize, backgroundColor: theme.colors.primary, opacity: pressed ? 0.72 : 1 },
          ]}
        >
          <Text style={[typography.headline, { color: theme.colors.onPrimary }]}>{t('mobileParity.common.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FilterButton({
  platform,
  label,
  kind,
  active,
  onPress,
}: {
  platform: AdaptivePlatform;
  label: string;
  kind: PaymentFilterKind;
  active: boolean;
  onPress: (kind: PaymentFilterKind) => void;
}) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const Icon = kind === 'date'
    ? CalendarDays
    : kind === 'amount'
      ? CircleDollarSign
      : kind === 'account'
        ? WalletCards
        : SlidersHorizontal;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobileParity.payments.filterA11y', { label })}
      accessibilityState={{ selected: active }}
      onPress={() => onPress(kind)}
      style={({ pressed }) => [
        styles.filterButton,
        {
          minHeight: theme.minimumHitSize,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surface,
          borderRadius: platform === 'ios' ? 10 : theme.radius.pill,
          opacity: pressed ? 0.62 : 1,
        },
      ]}
    >
      <Icon size={17} color={active ? theme.colors.primary : theme.colors.textMuted} />
      <Text numberOfLines={1} style={[typography.caption, { color: theme.colors.text }]}>{label}</Text>
      <ChevronDown size={15} color={theme.colors.textMuted} />
    </Pressable>
  );
}

function PaymentRow({
  item,
  platform,
  model,
  actions,
  isLast,
}: {
  item: PaymentHistoryItem;
  platform: AdaptivePlatform;
  model: PaymentHistoryViewModel;
  actions: PaymentHistoryActions;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const subtitle = [item.paidAtLabel, item.bucketName, item.accountName, item.categoryName].filter(Boolean).join(' • ');
  const amount = formatMoney(Math.abs(item.amount), model.locale, model.currency);
  const signedAmount = `${t(item.direction === 'deposit' ? 'mobileParity.payments.plus' : 'mobileParity.payments.minus')} ${amount}`;

  return (
    <View
      style={[
        styles.paymentRow,
        !isLast && { borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View
        accessible
        accessibilityLabel={t('mobileParity.payments.rowA11y', { name: item.billName, direction: signedAmount.split(' ')[0], amount, details: subtitle, pending: item.pendingSync ? `, ${t('mobileParity.common.pendingSync')}` : '' })}
        style={styles.paymentCopy}
      >
        <View style={styles.paymentTitleRow}>
          <Text numberOfLines={1} style={[typography.headline, styles.paymentTitle, { color: theme.colors.text }]}>{item.billName}</Text>
          {item.pendingSync ? (
            <View style={[styles.pendingBadge, { backgroundColor: theme.colors.accentContainer }]}>
              <Text style={[typography.caption, { color: theme.colors.accent }]}>{t('mobileParity.common.pendingSync')}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={2} style={[typography.caption, { color: theme.colors.textMuted }]}>{subtitle}</Text>
        {item.note ? <Text numberOfLines={1} style={[typography.caption, { color: theme.colors.textSecondary }]}>{item.note}</Text> : null}
        {item.derivedPaymentLabel ? <Text numberOfLines={1} style={[typography.caption, { color: theme.colors.textSecondary }]}>{item.derivedPaymentLabel}</Text> : null}
      </View>
      <View style={styles.paymentAmountColumn}>
        <MoneyText
          platform={platform}
          amount={item.direction === 'deposit' ? Math.abs(item.amount) : -Math.abs(item.amount)}
          signed
          tone={item.direction === 'deposit' ? 'income' : 'expense'}
          style={styles.paymentAmount}
        />
        {item.canModify ? <View style={styles.rowActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileParity.payments.editA11y', { name: item.billName })}
            hitSlop={8}
            onPress={() => actions.onEditPayment(item.id)}
            style={({ pressed }) => [styles.iconButton, { minWidth: theme.minimumHitSize, minHeight: theme.minimumHitSize, opacity: pressed ? 0.5 : 1 }]}
          >
            <Pencil size={19} color={theme.colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileParity.payments.deleteA11y', { name: item.billName })}
            accessibilityHint={t('mobileParity.payments.deleteHint')}
            hitSlop={8}
            onPress={() => actions.onDeletePayment(item.id)}
            style={({ pressed }) => [styles.iconButton, { minWidth: theme.minimumHitSize, minHeight: theme.minimumHitSize, opacity: pressed ? 0.5 : 1 }]}
          >
            <Trash2 size={19} color={theme.colors.danger} />
          </Pressable>
        </View> : null}
      </View>
    </View>
  );
}

export default function PaymentHistoryScreen({
  model,
  actions,
  platform = Platform.OS === 'ios' ? 'ios' : 'android',
  title,
}: PaymentHistoryScreenProps) {
  const { t } = useTranslation();
  const displayTitle = title ?? t('mobileParity.payments.title');
  const theme = useAdaptiveTheme(platform);
  const layout = useAdaptiveLayout();
  const topInset = useAndroidTopInset(platform);

  if (model.status === 'loading') {
    return <StatusPanel platform={platform} title={t('mobileParity.payments.loadingTitle')} message={t('mobileParity.payments.loadingBody')} loading />;
  }
  if (model.status === 'error') {
    return <StatusPanel platform={platform} title={t('mobileParity.payments.unavailableTitle')} message={model.errorMessage ?? t('mobileParity.payments.unavailableBody')} onRetry={actions.onRetry} />;
  }
  if (model.status === 'permission-denied') {
    return <StatusPanel platform={platform} title={t('mobileParity.payments.restrictedTitle')} message={model.permissionMessage ?? t('mobileParity.payments.restrictedBody')} />;
  }

  const updateFilters = (patch: Partial<PaymentHistoryFilters>) => {
    actions.onChangeFilters({ ...model.filters, ...patch });
  };

  const header = (
    <View style={styles.headerStack}>
      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <Text accessibilityRole="header" style={[typography.title, { color: theme.colors.text }]}>{displayTitle}</Text>
          <Text style={[typography.body, { color: theme.colors.textMuted }]}>
            {t('mobileParity.payments.count', { count: model.totalItems, bucket: model.filters.bucketLabel.toLocaleLowerCase() })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobileParity.payments.sortA11y', { sort: localizedSortLabel(t, model.sort) })}
          onPress={actions.onOpenSort}
          style={({ pressed }) => [styles.sortButton, { minHeight: theme.minimumHitSize, borderColor: theme.colors.border, opacity: pressed ? 0.62 : 1 }]}
        >
          <SlidersHorizontal size={18} color={theme.colors.primary} />
          <Text style={[typography.caption, { color: theme.colors.text }]}>{localizedSortLabel(t, model.sort)}</Text>
        </Pressable>
      </View>

      {model.offline ? (
        <View accessible accessibilityRole="alert" style={[styles.offlineBanner, { backgroundColor: theme.colors.accentContainer }]}>
          <Text style={[typography.callout, { color: theme.colors.accent }]}>{t('mobileParity.payments.offlineSaved', { updated: model.lastUpdatedLabel ? ` · ${model.lastUpdatedLabel}` : '' })}</Text>
        </View>
      ) : null}

      <AdaptiveSurface style={[styles.summary, { backgroundColor: theme.colors.surface }]} accessibilityLabel={t('mobileParity.payments.totalsA11y', { income: formatMoney(model.summary.income, model.locale, model.currency), expenses: formatMoney(model.summary.expenses, model.locale, model.currency), net: formatMoney(model.summary.net, model.locale, model.currency) })}>
        <View style={styles.summaryPrimary}>
          <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.payments.netTotal')}</Text>
          <MoneyText platform={platform} amount={model.summary.net} signed tone={model.summary.net >= 0 ? 'income' : 'expense'} style={styles.netAmount} />
        </View>
        <View style={styles.summaryDetails}>
          <View style={styles.summaryMetric}>
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.common.income')}</Text>
            <MoneyText platform={platform} amount={model.summary.income} tone="income" style={styles.summaryAmount} />
          </View>
          <View style={styles.summaryMetric}>
            <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t('mobileParity.common.expenses')}</Text>
            <MoneyText platform={platform} amount={model.summary.expenses} tone="expense" style={styles.summaryAmount} />
          </View>
        </View>
      </AdaptiveSurface>

      <View style={[styles.searchBox, { minHeight: theme.minimumHitSize, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: platform === 'ios' ? 10 : theme.radius.pill }]}>
        <Search size={19} color={theme.colors.textMuted} />
        <TextInput
          accessibilityLabel={t('mobileParity.payments.searchA11y')}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          placeholder={t('mobileParity.payments.searchPlaceholder')}
          placeholderTextColor={theme.colors.textMuted}
          value={model.filters.query}
          onChangeText={(query) => updateFilters({ query })}
          style={[typography.body, styles.searchInput, { color: theme.colors.text }]}
        />
      </View>

      <SegmentedControl
        platform={platform}
        label={t('mobileParity.payments.type')}
        value={model.filters.direction}
        onChange={(direction) => updateFilters({ direction })}
        options={[
          { value: 'all', label: t('mobileParity.common.all') },
          { value: 'expense', label: t('mobileParity.common.expenses') },
          { value: 'deposit', label: t('mobileParity.common.income') },
        ]}
      />

      <View style={styles.filtersWrap}>
        <FilterButton platform={platform} label={model.filters.dateLabel} kind="date" active={model.filters.dateRange !== 'all'} onPress={actions.onOpenFilter} />
        <FilterButton
          platform={platform}
          label={model.filters.minAmount !== null || model.filters.maxAmount !== null
            ? `${model.filters.minAmount ?? t('mobileParity.payments.any')}–${model.filters.maxAmount ?? t('mobileParity.payments.any')}`
            : t('mobileParity.payments.anyAmount')}
          kind="amount"
          active={model.filters.minAmount !== null || model.filters.maxAmount !== null}
          onPress={actions.onOpenFilter}
        />
        <FilterButton platform={platform} label={model.filters.accountLabel} kind="account" active={Boolean(model.filters.accountId)} onPress={actions.onOpenFilter} />
        <FilterButton platform={platform} label={model.filters.categoryLabel} kind="category" active={Boolean(model.filters.categoryId)} onPress={actions.onOpenFilter} />
        <FilterButton platform={platform} label={model.filters.bucketLabel} kind="bucket" active={Boolean(model.filters.bucketId)} onPress={actions.onOpenFilter} />
      </View>

      {hasActivePaymentFilters(model.filters) ? (
        <Pressable
          accessibilityRole="button"
          onPress={actions.onResetFilters}
          style={({ pressed }) => [styles.resetButton, { minHeight: theme.minimumHitSize, opacity: pressed ? 0.55 : 1 }]}
        >
          <Text style={[typography.callout, { color: theme.colors.primary }]}>{t('mobileParity.payments.resetFilters')}</Text>
        </Pressable>
      ) : null}

      <View style={styles.exportRow} accessibilityLabel={t('mobileParity.payments.exportA11y')}>
        {exportActions.map(({ format, label, icon: Icon }) => (
          <Pressable
            key={format}
            accessibilityRole="button"
            accessibilityLabel={t('mobileParity.payments.exportFormatA11y', { format: format === 'print' ? t('mobileParity.payments.print') : format === 'share' ? t('mobileParity.payments.share') : label })}
            onPress={() => actions.onExport(format)}
            style={({ pressed }) => [styles.exportButton, { minHeight: theme.minimumHitSize, borderColor: theme.colors.border, opacity: pressed ? 0.55 : 1 }]}
          >
            <Icon size={18} color={theme.colors.primary} />
            <Text style={[typography.caption, { color: theme.colors.text }]}>{format === 'print' ? t('mobileParity.payments.print') : format === 'share' ? t('mobileParity.payments.share') : label}</Text>
          </Pressable>
        ))}
      </View>

      <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>{t('mobileParity.payments.payments')}</Text>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }, topInset > 0 && { paddingTop: topInset }]}>
      <FlashList
        data={model.payments}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.listContent,
          { paddingHorizontal: layout.horizontalPadding, maxWidth: theme.contentMaxWidth },
          model.payments.length === 0 && styles.emptyListContent,
        ]}
        ListHeaderComponent={header}
        ListEmptyComponent={(
          <AdaptiveSurface style={styles.emptyPanel}>
            <Text accessibilityRole="header" style={[typography.headline, { color: theme.colors.text }]}>{t('mobileParity.payments.emptyTitle')}</Text>
            <Text style={[typography.body, styles.stateMessage, { color: theme.colors.textMuted }]}>{t('mobileParity.payments.emptyBody')}</Text>
          </AdaptiveSurface>
        )}
        renderItem={({ item, index }) => (
          <View style={[styles.listGroup, index === 0 && { borderTopLeftRadius: theme.radius.medium, borderTopRightRadius: theme.radius.medium }, index === model.payments.length - 1 && { borderBottomLeftRadius: theme.radius.medium, borderBottomRightRadius: theme.radius.medium }, { backgroundColor: theme.colors.surface }]}>
            <PaymentRow item={item} platform={platform} model={model} actions={actions} isLast={index === model.payments.length - 1} />
          </View>
        )}
        ListFooterComponent={model.page < model.totalPages ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobileParity.payments.pageA11y', { page: model.page + 1, total: model.totalPages })}
            onPress={actions.onLoadMore}
            style={({ pressed }) => [styles.loadMore, { minHeight: theme.minimumHitSize, opacity: pressed ? 0.58 : 1 }]}
          >
            <Text style={[typography.callout, { color: theme.colors.primary }]}>{t('mobileParity.common.loadMore')}</Text>
          </Pressable>
        ) : <View style={styles.footerSpace} />}
        refreshControl={<RefreshControl refreshing={Boolean(model.refreshing)} onRefresh={actions.onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  stateScreen: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center', gap: 12 },
  stateMessage: { textAlign: 'center', maxWidth: 440 },
  primaryButton: { marginTop: 8, paddingHorizontal: 22, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  listContent: { width: '100%', alignSelf: 'center', paddingTop: 20 },
  emptyListContent: { flexGrow: 1 },
  headerStack: { gap: 14, marginBottom: 12 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  titleCopy: { minWidth: 240, flex: 1, gap: 3 },
  sortButton: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  offlineBanner: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  summary: { padding: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20 },
  summaryPrimary: { flex: 1, minWidth: 180, gap: 2 },
  summaryDetails: { flexDirection: 'row', gap: 24 },
  summaryMetric: { alignItems: 'flex-end', gap: 2 },
  netAmount: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  summaryAmount: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  searchBox: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { minWidth: 0, flex: 1, paddingVertical: 0 },
  filtersWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterButton: { maxWidth: 220, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  resetButton: { alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 4 },
  exportRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  exportButton: { flexGrow: 1, minWidth: 86, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  listGroup: { overflow: 'hidden' },
  paymentRow: { minHeight: 86, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 12 },
  paymentCopy: { minWidth: 0, flex: 1, gap: 3 },
  paymentTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paymentTitle: { minWidth: 0, flexShrink: 1 },
  pendingBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  paymentAmountColumn: { alignItems: 'flex-end', gap: 1 },
  paymentAmount: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  emptyPanel: { marginTop: 8, padding: 28, alignItems: 'center', gap: 6 },
  loadMore: { alignItems: 'center', justifyContent: 'center', marginVertical: 14 },
  footerSpace: { height: 32 },
});
