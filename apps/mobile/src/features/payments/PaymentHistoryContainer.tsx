import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useMobileRuntime } from '../../context/MobileRuntimeContext';
import { useTheme } from '../../context/ThemeContext';
import {
  formatDate,
  getFormattingConfig,
  getMoneyInputProps,
  parseMoneyInput,
} from '../../i18n/format';
import { createAndSharePdf, printHtml, shareCsv } from '../../native/shareExport';
import type { Payment } from '../../types';
import PaymentHistoryScreen from './PaymentHistoryScreen';
import {
  derivePaymentHistorySummary,
  emptyPaymentHistoryFilters,
  filterAndSortPayments,
  paymentCanBeModified,
  type PaymentExportFormat,
  type PaymentFilterKind,
  type PaymentHistoryFilters,
  type PaymentHistoryItem,
  type PaymentSort,
} from './models';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function paymentHtml(items: PaymentHistoryItem[], currency: string, locale: string, labels: { title: string; date: string; bill: string; bucket: string; amount: string }): string {
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const rows = items.map((item) => `<tr><td>${item.paidAtLabel}</td><td>${item.billName}</td><td>${item.bucketName}</td><td style="text-align:right">${money.format(item.direction === 'deposit' ? item.amount : -item.amount)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#17231e;padding:28px}h1{color:#006c4c}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #d8e1dc;text-align:left}</style></head><body><h1>${labels.title}</h1><table><thead><tr><th>${labels.date}</th><th>${labels.bill}</th><th>${labels.bucket}</th><th style="text-align:right">${labels.amount}</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function localizedSortLabel(t: TFunction, sort: PaymentSort): string {
  const keys: Record<PaymentSort, string> = {
    date_desc: 'mobileParity.payments.sortNewest', date_asc: 'mobileParity.payments.sortOldest', amount_desc: 'mobileParity.payments.sortHighest', amount_asc: 'mobileParity.payments.sortLowest', bill_asc: 'mobileParity.payments.sortNameAsc', bill_desc: 'mobileParity.payments.sortNameDesc',
  };
  return t(keys[sort]);
}

function localizedEmptyFilters(t: TFunction): PaymentHistoryFilters {
  return { ...emptyPaymentHistoryFilters, dateLabel: t('mobileParity.payments.anyDate'), accountLabel: t('mobileParity.payments.allAccounts'), categoryLabel: t('mobileParity.payments.allCategories'), bucketLabel: t('mobileParity.payments.allBuckets') };
}

export default function PaymentHistoryContainer() {
  const { t } = useTranslation();
  const runtime = useMobileRuntime();
  const { colors } = useTheme();
  const formatting = getFormattingConfig();
  const moneyInputProps = getMoneyInputProps();
  const [filters, setFilters] = useState<PaymentHistoryFilters>(() => localizedEmptyFilters(t));
  const [sort, setSort] = useState<PaymentSort>('date_desc');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeFilter, setActiveFilter] = useState<PaymentFilterKind | null>(null);
  const [showSort, setShowSort] = useState(false);
  const [dateFromDraft, setDateFromDraft] = useState('');
  const [dateToDraft, setDateToDraft] = useState('');
  const [minAmountDraft, setMinAmountDraft] = useState('');
  const [maxAmountDraft, setMaxAmountDraft] = useState('');
  const [customDateDraftVisible, setCustomDateDraftVisible] = useState(false);

  const billMap = useMemo(
    () => new Map([...runtime.bills, ...runtime.archivedBills].map((bill) => [bill.id, bill])),
    [runtime.archivedBills, runtime.bills],
  );
  const items = useMemo<PaymentHistoryItem[]>(() => runtime.payments.map((payment) => {
    const bill = billMap.get(payment.bill_id);
    const type = payment.bill_type ?? payment.original_bill_type ?? bill?.type;
    return {
      id: String(payment.id),
      billId: String(payment.bill_id),
      billName: payment.bill_name ?? bill?.name ?? t('mobileParity.payments.billFallback', { id: payment.bill_id }),
      amount: payment.amount,
      direction: type === 'deposit' || payment.is_received_payment ? 'deposit' : 'expense',
      paidAt: payment.payment_date,
      paidAtLabel: formatDate(payment.payment_date),
      bucketName: payment.database_name ?? bill?.database_name ?? t('mobileParity.payments.currentBucket'),
      accountName: bill?.account ?? undefined,
      categoryName: bill?.category ?? undefined,
      note: payment.notes ?? undefined,
      pendingSync: payment.id < 0,
      canModify: paymentCanBeModified(payment),
      derivedPaymentLabel: payment.is_received_payment
        ? t('mobileParity.payments.receivedShared')
        : payment.is_share_payment
          ? t('mobileParity.payments.sharedManaged')
          : undefined,
    };
  }), [billMap, runtime.payments, t]);

  const filtered = useMemo(
    () => filterAndSortPayments(items, filters, sort),
    [filters, items, sort],
  );

  const filterOptions = useMemo(() => ({
    account: [...new Set(items.map((item) => item.accountName).filter((value): value is string => Boolean(value)))].sort(),
    category: [...new Set(items.map((item) => item.categoryName).filter((value): value is string => Boolean(value)))].sort(),
    bucket: [...new Set(items.map((item) => item.bucketName).filter(Boolean))].sort(),
  }), [items]);

  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(0, page * pageSize);

  const changeFilters = (next: PaymentHistoryFilters) => {
    setFilters(next);
    setPage(1);
  };

  const openFilter = (kind: PaymentFilterKind) => {
    setDateFromDraft(filters.dateFrom);
    setDateToDraft(filters.dateTo);
    setMinAmountDraft(filters.minAmount?.toString() ?? '');
    setMaxAmountDraft(filters.maxAmount?.toString() ?? '');
    setCustomDateDraftVisible(filters.dateRange === 'custom');
    setActiveFilter(kind);
  };

  const chooseOption = (kind: 'account' | 'category' | 'bucket', value: string | null) => {
    changeFilters(kind === 'account'
      ? { ...filters, accountId: value, accountLabel: value ?? t('mobileParity.payments.allAccounts') }
      : kind === 'category'
        ? { ...filters, categoryId: value, categoryLabel: value ?? t('mobileParity.payments.allCategories') }
        : { ...filters, bucketId: value, bucketLabel: value ?? t('mobileParity.payments.allBuckets') });
    setActiveFilter(null);
  };

  const applyCustomDates = () => {
    const valid = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!valid(dateFromDraft) || !valid(dateToDraft) || (!dateFromDraft && !dateToDraft)) {
      Alert.alert(t('mobileParity.payments.checkDateRange'), t('mobileParity.payments.dateRequired'));
      return;
    }
    if (dateFromDraft && dateToDraft && dateFromDraft > dateToDraft) {
      Alert.alert(t('mobileParity.payments.checkDateRange'), t('mobileParity.payments.dateOrder'));
      return;
    }
    changeFilters({
      ...filters,
      dateRange: 'custom',
      dateLabel: dateFromDraft && dateToDraft
        ? `${dateFromDraft} – ${dateToDraft}`
        : dateFromDraft
          ? t('mobileParity.payments.fromDate', { date: dateFromDraft })
          : t('mobileParity.payments.throughDate', { date: dateToDraft }),
      dateFrom: dateFromDraft,
      dateTo: dateToDraft,
    });
    setActiveFilter(null);
  };

  const applyAmountRange = () => {
    const hasMinimum = Boolean(minAmountDraft.trim());
    const hasMaximum = Boolean(maxAmountDraft.trim());
    const minimum = hasMinimum ? parseMoneyInput(minAmountDraft) : null;
    const maximum = hasMaximum ? parseMoneyInput(maxAmountDraft) : null;
    if (
      (hasMinimum && minimum === null)
      || (hasMaximum && maximum === null)
      || (minimum !== null && maximum !== null && minimum > maximum)
    ) {
      Alert.alert(t('mobileParity.payments.checkAmountRange'), t('mobileParity.payments.amountRangeError'));
      return;
    }
    changeFilters({ ...filters, minAmount: minimum, maxAmount: maximum });
    setActiveFilter(null);
  };

  const exportPayments = async (format: PaymentExportFormat) => {
    const csv = [[t('mobileParity.payments.csvDate'), t('mobileParity.payments.csvBill'), t('mobileParity.payments.csvBucket'), t('mobileParity.payments.csvAccount'), t('mobileParity.payments.csvCategory'), t('mobileParity.payments.csvDirection'), t('mobileParity.payments.csvAmount'), t('mobileParity.payments.csvNotes')].map(csvCell).join(','), ...filtered.map((item) => [
      item.paidAt,
      item.billName,
      item.bucketName,
      item.accountName,
      item.categoryName,
      item.direction,
      item.amount,
      item.note,
    ].map(csvCell).join(','))].join('\n');
    const html = paymentHtml(filtered, formatting.currency, formatting.locale, { title: t('mobileParity.payments.exportTitle'), date: t('mobileParity.payments.csvDate'), bill: t('mobileParity.payments.csvBill'), bucket: t('mobileParity.payments.csvBucket'), amount: t('mobileParity.payments.csvAmount') });
    try {
      if (format === 'csv') await shareCsv('billmanager-payments', csv);
      else if (format === 'print') await printHtml(html);
      else await createAndSharePdf(t('mobileParity.payments.exportTitle'), html);
    } catch (reason) {
      Alert.alert(t('mobileParity.payments.exportUnavailable'), reason instanceof Error ? reason.message : t('mobileParity.payments.exportFailed'));
    }
  };

  const beginEdit = (id: string) => {
    const payment = runtime.payments.find((candidate) => String(candidate.id) === id);
    if (!payment || !paymentCanBeModified(payment)) return;
    setEditing(payment);
    setEditAmount(String(payment.amount));
    setEditDate(payment.payment_date);
    setEditNotes(payment.notes ?? '');
  };

  const saveEdit = async () => {
    if (!editing) return;
    const amount = parseMoneyInput(editAmount);
    if (amount === null || !/^\d{4}-\d{2}-\d{2}$/.test(editDate)) {
      Alert.alert(t('mobileParity.payments.checkDetails'), t('mobileParity.payments.invalidDetails'));
      return;
    }
    setSaving(true);
    try {
      await runtime.updatePayment(editing, { amount, payment_date: editDate, notes: editNotes.trim() || null });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PaymentHistoryScreen
        model={{
          status: runtime.loading ? 'loading' : runtime.error && runtime.payments.length === 0 ? 'error' : 'ready',
          errorMessage: runtime.error ?? undefined,
          offline: !runtime.online,
          lastUpdatedLabel: runtime.lastSyncedAt ? formatDate(runtime.lastSyncedAt) : undefined,
          currency: formatting.currency,
          locale: formatting.locale,
          filters,
          sort,
          summary: derivePaymentHistorySummary(filtered),
          payments: visible,
          page,
          totalPages,
          totalItems: filtered.length,
          refreshing: runtime.syncing,
        }}
        actions={{
          onChangeFilters: changeFilters,
          onChangeSort: (next) => { setSort(next); setPage(1); },
          onOpenSort: () => setShowSort(true),
          onOpenFilter: openFilter,
          onResetFilters: () => changeFilters(localizedEmptyFilters(t)),
          onExport: (format) => void exportPayments(format),
          onEditPayment: beginEdit,
          onDeletePayment: (id) => {
            const payment = runtime.payments.find((candidate) => String(candidate.id) === id);
            if (!payment || !paymentCanBeModified(payment)) return;
            Alert.alert(t('mobileParity.payments.deleteTitle'), t('mobileParity.payments.deleteBody'), [
              { text: t('mobileParity.common.cancel'), style: 'cancel' },
              { text: t('mobileParity.common.delete'), style: 'destructive', onPress: () => void runtime.deletePayment(payment) },
            ]);
          },
          onLoadMore: () => setPage((current) => Math.min(totalPages, current + 1)),
          onRefresh: () => void runtime.syncNow().catch(() => undefined),
          onRetry: () => void runtime.syncNow().catch(() => undefined),
        }}
      />

      <Modal
        visible={activeFilter !== null}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setActiveFilter(null)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable accessibilityRole="button" onPress={() => setActiveFilter(null)}>
              <Text style={[styles.action, { color: colors.primary }]}>{t('mobileParity.common.cancel')}</Text>
            </Pressable>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{
              activeFilter === 'date'
                ? t('mobileParity.payments.filterDates')
                : activeFilter === 'amount'
                  ? t('mobileParity.payments.filterAmounts')
                  : activeFilter === 'account'
                    ? t('mobileParity.payments.account')
                    : activeFilter === 'category'
                      ? t('mobileParity.payments.category')
                      : t('mobileParity.payments.bucket')
            }</Text>
            <View style={styles.actionSpacer} />
          </View>
          <ScrollView contentContainerStyle={styles.filterForm} keyboardShouldPersistTaps="handled">
            {activeFilter === 'date' ? (
              <>
                <Text style={[styles.filterHelp, { color: colors.textSecondary }]}>{t('mobileParity.payments.dateHelp')}</Text>
                <View style={styles.optionList}>
                  {([
                    ['all', t('mobileParity.payments.anyDate')],
                    ['month', t('mobileParity.payments.thisMonth')],
                    ['quarter', t('mobileParity.payments.lastThreeMonths')],
                    ['year', t('mobileParity.payments.lastTwelveMonths')],
                    ['custom', t('mobileParity.payments.customRange')],
                  ] as Array<[PaymentHistoryFilters['dateRange'], string]>).map(([value, label]) => {
                    const selected = value === 'custom'
                      ? customDateDraftVisible
                      : !customDateDraftVisible && filters.dateRange === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          if (value === 'custom') {
                            setCustomDateDraftVisible(true);
                            return;
                          }
                          setCustomDateDraftVisible(false);
                          changeFilters({
                            ...filters,
                            dateRange: value,
                            dateLabel: label,
                            dateFrom: '',
                            dateTo: '',
                          });
                          setActiveFilter(null);
                        }}
                        style={[styles.optionRow, { backgroundColor: selected ? `${colors.primary}16` : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
                      >
                        <Text style={[styles.optionText, { color: selected ? colors.primary : colors.text }]}>{label}</Text>
                        {selected ? <Text style={[styles.check, { color: colors.primary }]}>✓</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
                {customDateDraftVisible ? (
                  <View style={styles.customFields}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>{t('mobileParity.payments.from')}</Text>
                    <TextInput accessibilityLabel={t('mobileParity.payments.fromDateA11y')} autoCapitalize="none" placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={dateFromDraft} onChangeText={setDateFromDraft} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
                    <Text style={[styles.label, { color: colors.textSecondary }]}>{t('mobileParity.payments.through')}</Text>
                    <TextInput accessibilityLabel={t('mobileParity.payments.throughDateA11y')} autoCapitalize="none" placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} value={dateToDraft} onChangeText={setDateToDraft} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
                    <Pressable accessibilityRole="button" onPress={applyCustomDates} style={[styles.applyButton, { backgroundColor: colors.primary }]}>
                      <Text style={styles.applyButtonText}>{t('mobileParity.payments.applyDates')}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : activeFilter === 'amount' ? (
              <>
                <Text style={[styles.filterHelp, { color: colors.textSecondary }]}>{t('mobileParity.payments.amountHelp')}</Text>
                <Text style={[styles.label, { color: colors.textSecondary }]}>{t('mobileParity.payments.minimumAmount')}</Text>
                <TextInput accessibilityLabel={t('mobileParity.payments.minimumA11y')} {...moneyInputProps} placeholderTextColor={colors.textMuted} value={minAmountDraft} onChangeText={setMinAmountDraft} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
                <Text style={[styles.label, { color: colors.textSecondary }]}>{t('mobileParity.payments.maximumAmount')}</Text>
                <TextInput accessibilityLabel={t('mobileParity.payments.maximumA11y')} {...moneyInputProps} placeholderTextColor={colors.textMuted} value={maxAmountDraft} onChangeText={setMaxAmountDraft} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
                <Pressable accessibilityRole="button" onPress={applyAmountRange} style={[styles.applyButton, { backgroundColor: colors.primary }]}>
                  <Text style={styles.applyButtonText}>{t('mobileParity.payments.applyAmount')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { changeFilters({ ...filters, minAmount: null, maxAmount: null }); setActiveFilter(null); }}
                  style={styles.clearButton}
                >
                  <Text style={[styles.clearButtonText, { color: colors.primary }]}>{t('mobileParity.payments.anyAmount')}</Text>
                </Pressable>
              </>
            ) : activeFilter ? (
              <View style={styles.optionList}>
                {[null, ...filterOptions[activeFilter]].map((value) => {
                  const selected = activeFilter === 'account'
                    ? filters.accountId === value
                    : activeFilter === 'category'
                      ? filters.categoryId === value
                      : filters.bucketId === value;
                  const allLabel = activeFilter === 'account'
                    ? t('mobileParity.payments.allAccounts')
                    : activeFilter === 'category'
                      ? t('mobileParity.payments.allCategories')
                      : t('mobileParity.payments.allBuckets');
                  return (
                    <Pressable
                      key={value ?? `_all_${activeFilter}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => chooseOption(activeFilter, value)}
                      style={[styles.optionRow, { backgroundColor: selected ? `${colors.primary}16` : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
                    >
                      <Text style={[styles.optionText, { color: selected ? colors.primary : colors.text }]}>{value ?? allLabel}</Text>
                      {selected ? <Text style={[styles.check, { color: colors.primary }]}>✓</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showSort} animationType="fade" transparent onRequestClose={() => setShowSort(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowSort(false)}>
          <View style={[styles.sortSheet, { backgroundColor: colors.surface }]}>
            <Text accessibilityRole="header" style={[styles.sortTitle, { color: colors.text }]}>{t('mobileParity.payments.sortTitle')}</Text>
            {(['date_desc', 'date_asc', 'amount_desc', 'amount_asc', 'bill_asc', 'bill_desc'] as PaymentSort[]).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: sort === value }}
                onPress={() => { setSort(value); setPage(1); setShowSort(false); }}
                style={[styles.optionRow, { backgroundColor: sort === value ? `${colors.primary}16` : colors.background, borderColor: sort === value ? colors.primary : colors.border }]}
              >
                <Text style={[styles.optionText, { color: sort === value ? colors.primary : colors.text }]}>{localizedSortLabel(t, value)}</Text>
                {sort === value ? <Text style={[styles.check, { color: colors.primary }]}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(editing)} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable accessibilityRole="button" onPress={() => setEditing(null)}><Text style={[styles.action, { color: colors.primary }]}>{t('mobileParity.common.cancel')}</Text></Pressable>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t('mobileParity.payments.editPayment')}</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ busy: saving }} disabled={saving} onPress={() => void saveEdit()}><Text style={[styles.action, { color: colors.primary }]}>{saving ? t('mobileParity.payments.saving') : t('mobileParity.common.save')}</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('billModal.amountLabel')}</Text>
            <TextInput accessibilityLabel={t('mobileParity.payments.amountA11y')} {...moneyInputProps} value={editAmount} onChangeText={setEditAmount} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('mobileParity.billDetail.paymentDate')}</Text>
            <TextInput accessibilityLabel={t('mobileParity.payments.dateA11y')} autoCapitalize="none" value={editDate} onChangeText={setEditDate} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
            <Text style={[styles.label, { color: colors.textSecondary }]}>{t('billModal.notesLabel')}</Text>
            <TextInput accessibilityLabel={t('mobileParity.payments.notesA11y')} multiline value={editNotes} onChangeText={setEditNotes} style={[styles.input, styles.notes, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  header: { minHeight: 58, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  action: { minWidth: 60, fontSize: 16, fontWeight: '600' },
  actionSpacer: { width: 60 },
  title: { fontSize: 17, fontWeight: '700' },
  form: { padding: 20, gap: 9 },
  filterForm: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 20, gap: 12 },
  filterHelp: { fontSize: 14, lineHeight: 20 },
  optionList: { gap: 8 },
  optionRow: { minHeight: 50, borderWidth: StyleSheet.hairlineWidth, borderRadius: 13, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  optionText: { minWidth: 0, flex: 1, fontSize: 15, fontWeight: '600' },
  check: { fontSize: 18, fontWeight: '800' },
  customFields: { gap: 9, marginTop: 6 },
  label: { marginTop: 8, fontSize: 13, fontWeight: '600' },
  input: { minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14, fontSize: 16 },
  notes: { minHeight: 110, paddingTop: 14, textAlignVertical: 'top' },
  applyButton: { minHeight: 52, borderRadius: 14, marginTop: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  applyButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  clearButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  clearButtonText: { fontSize: 15, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sortSheet: { width: '100%', maxWidth: 380, borderRadius: 18, padding: 16, gap: 8 },
  sortTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
});
