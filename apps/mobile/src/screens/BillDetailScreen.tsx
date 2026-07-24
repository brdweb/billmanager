import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
  Alert,
  Platform,
  Switch,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Swipeable } from 'react-native-gesture-handler';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { useMobileRuntime } from '../context/MobileRuntimeContext';
import {
  formatCurrency,
  formatDate,
  getMoneyInputProps,
  parseMoneyInput,
} from '../i18n/format';
import { Bill, Payment } from '../types';
import ShareBillModal from '../components/ShareBillModal';
import { useTranslation } from 'react-i18next';

type BillsStackParamList = {
  BillsList: undefined;
  BillDetail: { billId: number };
  AddBill: { bill?: Bill };
};

type Props = NativeStackScreenProps<BillsStackParamList, 'BillDetail'>;

function formatBillAmount(amount: number | null, average: number | undefined, variableLabel: string): string {
  if (amount !== null) return formatCurrency(amount);
  return average && average > 0 ? `~${formatCurrency(average)}` : variableLabel;
}

export default function BillDetailScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { billId } = route.params;
  const { colors } = useTheme();
  const runtime = useMobileRuntime();
  const bill = [...runtime.bills, ...runtime.archivedBills]
    .find((candidate) => candidate.id === billId) ?? null;
  const payments = runtime.payments.filter((payment) => payment.bill_id === billId);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date());
  const [payNotes, setPayNotes] = useState('');
  const [advanceDue, setAdvanceDue] = useState(true);
  const [showPayDatePicker, setShowPayDatePicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Payment edit/delete state
  const [editPayment, setEditPayment] = useState<Payment | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [deletePayment, setDeletePayment] = useState<Payment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const swipeableRefs = useRef<Map<number, Swipeable>>(new Map());

  // Share modal state
  const [showShareModal, setShowShareModal] = useState(false);

  const styles = createStyles(colors);
  const moneyInputProps = getMoneyInputProps();

  useEffect(() => {
    if (bill) setPayAmount((bill.amount ?? bill.avg_amount ?? '').toString());
  }, [bill?.id, bill?.amount, bill?.avg_amount]);

  const handlePay = async () => {
    if (!bill) return;

    const amount = parseMoneyInput(payAmount);
    if (amount === null || amount <= 0) {
      Alert.alert(t('mobileParity.payments.checkDetails'), t('mobileParity.billDetail.invalidAmount'));
      return;
    }

    setIsSubmitting(true);
    // Use local date components to avoid UTC timezone shift.
    const paymentDate = `${payDate.getFullYear()}-${String(payDate.getMonth() + 1).padStart(2, '0')}-${String(payDate.getDate()).padStart(2, '0')}`;
    try {
      await runtime.recordPayment({
        bill,
        amount,
        paymentDate,
        notes: payNotes.trim() || undefined,
        advanceDue,
      });
      setShowPayModal(false);
      setPayNotes('');
      Alert.alert(t('mobileParity.common.success'), t('mobileParity.billDetail.recorded'));
    } catch (reason) {
      Alert.alert(t('mobileParity.common.error'), reason instanceof Error ? reason.message : t('mobileParity.billDetail.recordFailed'));
    }
    setIsSubmitting(false);
  };

  const handleMarkPortionPaid = async () => {
    if (!bill?.share_info) return;

    setIsSubmitting(true);
    const result = await api.markSharePaid(bill.share_info.share_id);

    if (result.success) {
      await runtime.syncNow().catch(() => null);
      const wasPaid = bill.share_info.my_portion_paid;
      Alert.alert(t('mobileParity.common.success'), wasPaid ? t('mobileParity.billDetail.markedUnpaid') : t('mobileParity.billDetail.markedPaid'));
    } else {
      Alert.alert(t('mobileParity.common.error'), result.error || t('mobileParity.billDetail.updateFailed'));
    }
    setIsSubmitting(false);
  };

  const handleEditBill = () => {
    if (bill) {
      navigation.navigate('AddBill', { bill });
    }
  };

  const handleArchive = () => {
    if (!bill) return;

    Alert.alert(
      t('billModal.archive'),
      t('billModal.archiveConfirm'),
      [
        { text: t('mobileParity.common.cancel'), style: 'cancel' },
        {
          text: t('billModal.archive'),
          style: 'destructive',
          onPress: async () => {
            try {
              await runtime.archiveBill(bill);
              navigation.goBack();
            } catch (reason) {
              Alert.alert(t('mobileParity.common.error'), reason instanceof Error ? reason.message : t('mobileParity.billDetail.archiveFailed'));
            }
          },
        },
      ]
    );
  };

  const handleRestore = async () => {
    if (!bill) return;
    try {
      await runtime.restoreBill(bill);
      navigation.goBack();
    } catch (reason) {
      Alert.alert(t('mobileParity.common.error'), reason instanceof Error ? reason.message : t('mobileParity.billDetail.restoreFailed'));
    }
  };

  const handleDeleteBill = () => {
    if (!bill) return;

    Alert.alert(
      t('mobileParity.billDetail.deleteBill'),
      t('billModal.deleteConfirm'),
      [
        { text: t('mobileParity.common.cancel'), style: 'cancel' },
        {
          text: t('mobileParity.common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (!runtime.online) {
              Alert.alert(t('mobileParity.common.connectionRequired'), t('mobileParity.billDetail.deleteOffline'));
              return;
            }
            const result = await api.deleteBill(bill.id);
            if (result.success) {
              await runtime.syncNow().catch(() => null);
              navigation.goBack();
            } else {
              Alert.alert(t('mobileParity.common.error'), result.error || t('mobileParity.billDetail.deleteFailed'));
            }
          },
        },
      ]
    );
  };

  // Payment edit handlers
  const handleSwipeEdit = (payment: Payment) => {
    const ref = swipeableRefs.current.get(payment.id);
    ref?.close();
    setEditAmount(payment.amount.toString());
    setEditNotes(payment.notes || '');
    setEditPayment(payment);
  };

  const confirmEditPayment = async () => {
    if (!editPayment) return;

    const amount = parseMoneyInput(editAmount);
    if (amount === null || amount <= 0) {
      Alert.alert(t('mobileParity.payments.checkDetails'), t('mobileParity.billDetail.invalidAmount'));
      return;
    }

    setIsEditing(true);
    let errorMessage: string | null = null;
    try {
      await runtime.updatePayment(editPayment, {
        amount,
        payment_date: editPayment.payment_date,
        notes: editNotes.trim() || null,
      });
    } catch (reason) {
      errorMessage = reason instanceof Error ? reason.message : t('mobileParity.billDetail.updatePaymentFailed');
    }
    setIsEditing(false);

    if (!errorMessage) {
      setEditPayment(null);
    } else {
      Alert.alert(t('mobileParity.common.error'), errorMessage);
    }
  };

  // Payment delete handlers
  const handleSwipeDelete = (payment: Payment) => {
    const ref = swipeableRefs.current.get(payment.id);
    ref?.close();
    setDeletePayment(payment);
  };

  const confirmDeletePayment = async () => {
    if (!deletePayment) return;

    setIsDeleting(true);
    let errorMessage: string | null = null;
    try {
      await runtime.deletePayment(deletePayment);
    } catch (reason) {
      errorMessage = reason instanceof Error ? reason.message : t('mobileParity.billDetail.deletePaymentFailed');
    }
    setIsDeleting(false);

    if (!errorMessage) {
      setDeletePayment(null);
    } else {
      Alert.alert(t('mobileParity.common.error'), errorMessage);
    }
  };

  const renderLeftActions = (payment: Payment) => (
    <TouchableOpacity
      style={[styles.swipeAction, styles.editAction]}
      onPress={() => handleSwipeEdit(payment)}
    >
      <Text style={styles.swipeActionText}>{t('mobileParity.common.edit')}</Text>
    </TouchableOpacity>
  );

  const renderRightActions = (payment: Payment) => (
    <TouchableOpacity
      style={[styles.swipeAction, styles.deleteAction]}
      onPress={() => handleSwipeDelete(payment)}
    >
      <Text style={styles.swipeActionText}>{t('mobileParity.common.delete')}</Text>
    </TouchableOpacity>
  );

  if (runtime.loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (runtime.error || !bill) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{runtime.error || t('mobileParity.billDetail.notFound')}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.retryButtonText}>{t('mobileParity.billDetail.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isDeposit = bill.type === 'deposit';
  const isShared = bill.is_shared;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>← {t('mobileParity.billDetail.back')}</Text>
        </TouchableOpacity>
        {!isShared && (
          <TouchableOpacity onPress={handleEditBill} style={styles.headerButton}>
            <Text style={styles.headerButtonTextPrimary}>{t('mobileParity.common.edit')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.titleContainer}>
        <Text style={styles.title}>{bill.name}</Text>
        {isShared && bill.share_info && (
          <Text style={styles.subtitle}>{t('common.sharedBy', { name: bill.share_info.owner_name })}</Text>
        )}
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Bill Info Card */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('billModal.amountLabel')}</Text>
            <Text style={[styles.infoValue, { color: isDeposit ? colors.success : colors.danger }]}>
              {isDeposit ? '+' : '-'}{formatBillAmount(bill.amount, bill.avg_amount, t('mobileParity.bills.variable'))}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('mobileParity.billDetail.nextDue')}</Text>
            <Text style={styles.infoValue}>{formatDate(bill.next_due)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('billModal.frequencyLabel')}</Text>
            <Text style={styles.infoValue}>{t(`common.frequency.${bill.frequency === 'bi-weekly' ? 'biweekly' : bill.frequency}`)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('billModal.typeLabel')}</Text>
            <Text style={styles.infoValue}>{isDeposit ? t('mobileParity.common.income') : t('mobileParity.common.expenses')}</Text>
          </View>
          {bill.account && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('billModal.accountLabel')}</Text>
              <Text style={styles.infoValue}>{bill.account}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('mobileParity.billDetail.autoPay')}</Text>
            <Text style={styles.infoValue}>{bill.auto_payment ? t('mobileParity.billDetail.yes') : t('mobileParity.billDetail.no')}</Text>
          </View>
          {bill.notes && (
            <View style={styles.notesContainer}>
              <Text style={styles.infoLabel}>{t('billModal.notesLabel')}</Text>
              <Text style={styles.notesText}>{bill.notes}</Text>
            </View>
          )}
        </View>

        {/* Shared Bill Info */}
        {isShared && bill.share_info && (
          <View style={[styles.card, styles.sharedCard]}>
            <Text style={styles.sharedCardTitle}>{t('mobileParity.billDetail.sharingDetails')}</Text>

            {bill.share_info.my_portion !== null && bill.share_info.my_portion !== undefined && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('mobileParity.billDetail.myPortion')}</Text>
                <Text style={[styles.infoValue, { fontWeight: '700', color: colors.primary }]}>
                  {formatCurrency(bill.share_info.my_portion)}
                </Text>
              </View>
            )}

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t('mobileParity.billDetail.paymentStatus')}</Text>
              {bill.share_info.my_portion_paid ? (
                <View>
                  <Text style={[styles.infoValue, { color: colors.success }]}>✓ {t('mobileParity.billDetail.paid')}</Text>
                  {bill.share_info.my_portion_paid_date && (
                    <Text style={styles.paidDate}>
                      {formatDate(bill.share_info.my_portion_paid_date)}
                    </Text>
                  )}
                </View>
              ) : (
                <Text style={[styles.infoValue, { color: colors.textMuted }]}>{t('mobileParity.billDetail.notPaid')}</Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.markPaidButton, bill.share_info.my_portion_paid && styles.markUnpaidButton]}
              onPress={handleMarkPortionPaid}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.markPaidButtonText}>
                  {bill.share_info.my_portion_paid ? t('common.markAsUnpaid') : t('common.markMyPortionPaid')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Action Buttons - Only for owned bills */}
        {!isShared && (
          <>
            <View style={styles.actionRow}>
              {!bill.archived && (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => {
                    setPayDate(new Date());
                    setPayNotes('');
                    setAdvanceDue(true);
                    setShowPayModal(true);
                  }}
                >
                  <Text style={styles.primaryButtonText}>{t('mobileParity.billDetail.recordPayment')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={bill.archived ? handleRestore : handleArchive}
              >
                <Text style={styles.secondaryButtonText}>{bill.archived ? t('mobileParity.billDetail.restore') : t('mobileParity.billDetail.archive')}</Text>
              </TouchableOpacity>
            </View>

            {/* Share Button */}
            {!bill.archived && (
              <TouchableOpacity
                style={styles.shareButton}
                onPress={() => setShowShareModal(true)}
              >
                <Text style={styles.shareButtonText}>{t('mobileParity.billDetail.shareBill')}</Text>
              </TouchableOpacity>
            )}

            {/* Delete Button */}
            <TouchableOpacity
              style={styles.deleteBillButton}
              onPress={handleDeleteBill}
            >
              <Text style={styles.deleteBillButtonText}>{t('mobileParity.billDetail.deleteBill')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Payment History */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('mobileParity.billDetail.paymentHistory')}</Text>
          {payments.length > 0 && (
            <Text style={styles.swipeHint}>{t('mobileParity.billDetail.swipeHint')}</Text>
          )}
        </View>
        {payments.length === 0 ? (
          <View style={styles.card}>
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{t('paymentHistory.noPayments')}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            {payments.slice(0, 10).map((payment, index) => (
              <Swipeable
                key={payment.id}
                ref={(ref) => {
                  if (ref) {
                    swipeableRefs.current.set(payment.id, ref);
                  }
                }}
                renderLeftActions={() => renderLeftActions(payment)}
                renderRightActions={() => renderRightActions(payment)}
                leftThreshold={40}
                rightThreshold={40}
                overshootLeft={false}
                overshootRight={false}
              >
                <View
                  style={[
                    styles.paymentRow,
                    index < payments.slice(0, 10).length - 1 && styles.paymentRowBorder,
                  ]}
                >
                  <View>
                    <Text style={styles.paymentDate}>{formatDate(payment.payment_date)}</Text>
                    {payment.notes && (
                      <Text style={styles.paymentNotes}>{payment.notes}</Text>
                    )}
                  </View>
                  <Text style={styles.paymentAmount}>{formatCurrency(payment.amount)}</Text>
                </View>
              </Swipeable>
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Record Payment Modal */}
      <Modal
        visible={showPayModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowPayModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('mobileParity.billDetail.recordPayment')}</Text>
            <Text style={styles.modalSubtitle}>{bill.name}</Text>

            <Text style={styles.inputLabel}>{t('billModal.amountLabel')}</Text>
            <TextInput
              style={styles.input}
              value={payAmount}
              onChangeText={setPayAmount}
              {...moneyInputProps}
              placeholderTextColor={colors.textMuted}
              editable={!isSubmitting}
            />

            <Text style={styles.inputLabel}>{t('mobileParity.billDetail.paymentDate')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('mobileParity.billDetail.paymentDate')}, ${formatDate(`${payDate.getFullYear()}-${String(payDate.getMonth() + 1).padStart(2, '0')}-${String(payDate.getDate()).padStart(2, '0')}`)}`}
              onPress={() => setShowPayDatePicker(true)}
              style={styles.dateButton}
            >
              <Text style={styles.dateButtonText}>{formatDate(`${payDate.getFullYear()}-${String(payDate.getMonth() + 1).padStart(2, '0')}-${String(payDate.getDate()).padStart(2, '0')}`)}</Text>
            </Pressable>
            {showPayDatePicker ? (
              <DateTimePicker
                value={payDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                maximumDate={new Date()}
                onChange={(_event, value) => {
                  if (Platform.OS !== 'ios') setShowPayDatePicker(false);
                  if (value) setPayDate(value);
                }}
              />
            ) : null}

            <Text style={styles.inputLabel}>{t('mobileParity.addBill.notesOptional')}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={payNotes}
              onChangeText={setPayNotes}
              placeholder={t('mobileParity.billDetail.paymentNotesPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              editable={!isSubmitting}
            />

            <View style={styles.advanceRow}>
              <View style={styles.advanceCopy}>
                <Text style={styles.advanceTitle}>{t('mobileParity.billDetail.advanceDue')}</Text>
                <Text style={styles.advanceBody}>{t('mobileParity.billDetail.advanceDueBody')}</Text>
              </View>
              <Switch
                accessibilityLabel={t('mobileParity.billDetail.advanceDueA11y')}
                value={advanceDue}
                disabled={isSubmitting}
                onValueChange={setAdvanceDue}
                trackColor={{ true: colors.primary }}
              />
            </View>

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setShowPayModal(false)}
                disabled={isSubmitting}
              >
                <Text style={styles.modalCancelText}>{t('mobileParity.common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalConfirmButton]}
                onPress={handlePay}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>{t('mobileParity.billDetail.record')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Payment Modal */}
      <Modal
        visible={editPayment !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setEditPayment(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('mobileParity.billDetail.editPayment')}</Text>
            <Text style={styles.modalSubtitle}>
              {editPayment && formatDate(editPayment.payment_date)}
            </Text>

            <Text style={styles.inputLabel}>{t('billModal.amountLabel')}</Text>
            <TextInput
              style={styles.input}
              value={editAmount}
              onChangeText={setEditAmount}
              {...moneyInputProps}
              placeholderTextColor={colors.textMuted}
              editable={!isEditing}
            />

            <Text style={styles.inputLabel}>{t('mobileParity.addBill.notesOptional')}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={editNotes}
              onChangeText={setEditNotes}
              placeholder={t('mobileParity.billDetail.notesPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              editable={!isEditing}
            />

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setEditPayment(null)}
                disabled={isEditing}
              >
                <Text style={styles.modalCancelText}>{t('mobileParity.common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalConfirmButton]}
                onPress={confirmEditPayment}
                disabled={isEditing}
              >
                {isEditing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>{t('mobileParity.common.save')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Payment Confirmation Modal */}
      <Modal
        visible={deletePayment !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setDeletePayment(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('mobileParity.billDetail.deletePayment')}</Text>
            <Text style={styles.modalMessage}>
              {t('mobileParity.billDetail.deletePaymentBody')}
            </Text>

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setDeletePayment(null)}
                disabled={isDeleting}
              >
                <Text style={styles.modalCancelText}>{t('mobileParity.common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalDeleteButton]}
                onPress={confirmDeletePayment}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>{t('mobileParity.common.delete')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Share Bill Modal */}
      {bill && (
        <ShareBillModal
          visible={showShareModal}
          onClose={() => setShowShareModal(false)}
          bill={bill}
          onShareCreated={() => { void runtime.syncNow().catch(() => null); }}
        />
      )}
    </View>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    backgroundColor: colors.surface,
  },
  headerButton: {
    padding: 4,
  },
  headerButtonText: {
    color: colors.primary,
    fontSize: 16,
  },
  headerButtonTextPrimary: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  titleContainer: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  notesContainer: {
    padding: 16,
  },
  notesText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 20,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  shareButton: {
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: colors.success + '15',
    alignItems: 'center',
    marginBottom: 12,
  },
  shareButtonText: {
    color: colors.success,
    fontSize: 15,
    fontWeight: '600',
  },
  deleteBillButton: {
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    marginBottom: 24,
  },
  deleteBillButtonText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  swipeHint: {
    fontSize: 12,
    color: colors.textMuted,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.surface,
  },
  paymentRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  paymentDate: {
    fontSize: 14,
    color: colors.text,
  },
  paymentNotes: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  paymentAmount: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  editAction: {
    backgroundColor: colors.primary,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  deleteAction: {
    backgroundColor: colors.danger,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  swipeActionText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  errorText: {
    fontSize: 16,
    color: colors.danger,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalMessage: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  inputLabel: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 16,
  },
  dateButton: {
    minHeight: 48,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.background,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  dateButtonText: {
    color: colors.text,
    fontSize: 16,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  advanceRow: {
    minHeight: 64,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  advanceCopy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  advanceTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  advanceBody: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelButton: {
    backgroundColor: colors.border,
  },
  modalCancelText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  modalConfirmButton: {
    backgroundColor: colors.primary,
  },
  modalDeleteButton: {
    backgroundColor: colors.danger,
  },
  modalConfirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Shared bill styles
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  sharedCard: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    backgroundColor: colors.primary + '08',
  },
  sharedCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  paidDate: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  markPaidButton: {
    backgroundColor: colors.success,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markUnpaidButton: {
    backgroundColor: colors.textMuted,
  },
  markPaidButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
