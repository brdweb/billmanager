import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { Bill, Payment } from '../types';
import ShareBillModal from '../components/ShareBillModal';

type BillsStackParamList = {
  BillsList: undefined;
  BillDetail: { billId: number };
  AddBill: { bill?: Bill };
};

type Props = NativeStackScreenProps<BillsStackParamList, 'BillDetail'>;

const formatCurrency = (amount: number | null, avgAmount?: number): string => {
  if (amount === null) {
    if (avgAmount && avgAmount > 0) {
      return `~$${avgAmount.toFixed(2)}`;
    }
    return 'Variable';
  }
  return `$${amount.toFixed(2)}`;
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export default function BillDetailScreen({ route, navigation }: Props) {
  const { billId } = route.params;
  const { colors } = useTheme();
  const [bill, setBill] = useState<Bill | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
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

  const fetchBillData = useCallback(async () => {
    try {
      const [billRes, paymentsRes] = await Promise.all([
        api.getBill(billId),
        api.getPayments(billId),
      ]);

      if (billRes.success && billRes.data) {
        setBill(billRes.data);
        setPayAmount(billRes.data.amount?.toString() || '');
      } else {
        setError(billRes.error || 'Failed to load bill');
      }

      if (paymentsRes.success && paymentsRes.data) {
        setPayments(paymentsRes.data);
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  }, [billId]);

  useEffect(() => {
    fetchBillData();
  }, [fetchBillData]);

  useFocusEffect(
    useCallback(() => {
      fetchBillData();
    }, [fetchBillData])
  );

  const handlePay = async () => {
    if (!bill) return;

    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount');
      return;
    }

    setIsSubmitting(true);
    const today = new Date().toISOString().split('T')[0];
    const result = await api.recordPayment(bill.id, amount, today);

    if (result.success) {
      setShowPayModal(false);
      fetchBillData();
      Alert.alert('Success', 'Payment recorded successfully');
    } else {
      Alert.alert('Error', result.error || 'Failed to record payment');
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
      'Archive Bill',
      `Are you sure you want to archive "${bill.name}"? You can unarchive it later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            const result = await api.archiveBill(bill.id);
            if (result.success) {
              navigation.goBack();
            } else {
              Alert.alert('Error', result.error || 'Failed to archive bill');
            }
          },
        },
      ]
    );
  };

  const handleDeleteBill = () => {
    if (!bill) return;

    Alert.alert(
      'Delete Bill',
      `Are you sure you want to permanently delete "${bill.name}"? This will also delete all payment history for this bill. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await api.deleteBill(bill.id);
            if (result.success) {
              navigation.goBack();
            } else {
              Alert.alert('Error', result.error || 'Failed to delete bill');
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

    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount');
      return;
    }

    setIsEditing(true);
    const result = await api.updatePayment(
      editPayment.id,
      amount,
      editPayment.payment_date,
      editNotes.trim() || undefined
    );
    setIsEditing(false);

    if (result.success) {
      setEditPayment(null);
      fetchBillData();
    } else {
      Alert.alert('Error', result.error || 'Failed to update payment');
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
    const result = await api.deletePayment(deletePayment.id);
    setIsDeleting(false);

    if (result.success) {
      setDeletePayment(null);
      fetchBillData();
    } else {
      Alert.alert('Error', result.error || 'Failed to delete payment');
    }
  };

  const renderLeftActions = (payment: Payment) => (
    <TouchableOpacity
      style={[styles.swipeAction, styles.editAction]}
      onPress={() => handleSwipeEdit(payment)}
    >
      <Text style={styles.swipeActionText}>Edit</Text>
    </TouchableOpacity>
  );

  const renderRightActions = (payment: Payment) => (
    <TouchableOpacity
      style={[styles.swipeAction, styles.deleteAction]}
      onPress={() => handleSwipeDelete(payment)}
    >
      <Text style={styles.swipeActionText}>Delete</Text>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !bill) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || 'Bill not found'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.retryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isDeposit = bill.type === 'deposit';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleEditBill} style={styles.headerButton}>
          <Text style={styles.headerButtonTextPrimary}>Edit</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.titleContainer}>
        <Text style={styles.title}>{bill.name}</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Bill Info Card */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Amount</Text>
            <Text style={[styles.infoValue, { color: isDeposit ? colors.success : colors.danger }]}>
              {isDeposit ? '+' : '-'}{formatCurrency(bill.amount, bill.avg_amount)}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Next Due</Text>
            <Text style={styles.infoValue}>{formatDate(bill.next_due)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Frequency</Text>
            <Text style={styles.infoValue}>{bill.frequency}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Type</Text>
            <Text style={styles.infoValue}>{isDeposit ? 'Income' : 'Expense'}</Text>
          </View>
          {bill.account && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Account</Text>
              <Text style={styles.infoValue}>{bill.account}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Auto-Pay</Text>
            <Text style={styles.infoValue}>{bill.auto_payment ? 'Yes' : 'No'}</Text>
          </View>
          {bill.notes && (
            <View style={styles.notesContainer}>
              <Text style={styles.infoLabel}>Notes</Text>
              <Text style={styles.notesText}>{bill.notes}</Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => setShowPayModal(true)}
          >
            <Text style={styles.primaryButtonText}>Record Payment</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleArchive}
          >
            <Text style={styles.secondaryButtonText}>Archive</Text>
          </TouchableOpacity>
        </View>

        {/* Share Button */}
        {!bill.archived && (
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => setShowShareModal(true)}
          >
            <Text style={styles.shareButtonText}>Share Bill</Text>
          </TouchableOpacity>
        )}

        {/* Delete Button */}
        <TouchableOpacity
          style={styles.deleteBillButton}
          onPress={handleDeleteBill}
        >
          <Text style={styles.deleteBillButtonText}>Delete Bill</Text>
        </TouchableOpacity>

        {/* Payment History */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Payment History</Text>
          {payments.length > 0 && (
            <Text style={styles.swipeHint}>Swipe to edit/delete</Text>
          )}
        </View>
        {payments.length === 0 ? (
          <View style={styles.card}>
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No payments recorded yet</Text>
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
            <Text style={styles.modalTitle}>Record Payment</Text>
            <Text style={styles.modalSubtitle}>{bill.name}</Text>

            <Text style={styles.inputLabel}>Amount</Text>
            <TextInput
              style={styles.input}
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              editable={!isSubmitting}
            />

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setShowPayModal(false)}
                disabled={isSubmitting}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalConfirmButton]}
                onPress={handlePay}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Record</Text>
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
            <Text style={styles.modalTitle}>Edit Payment</Text>
            <Text style={styles.modalSubtitle}>
              {editPayment && formatDate(editPayment.payment_date)}
            </Text>

            <Text style={styles.inputLabel}>Amount</Text>
            <TextInput
              style={styles.input}
              value={editAmount}
              onChangeText={setEditAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              editable={!isEditing}
            />

            <Text style={styles.inputLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={editNotes}
              onChangeText={setEditNotes}
              placeholder="Add notes..."
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
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalConfirmButton]}
                onPress={confirmEditPayment}
                disabled={isEditing}
              >
                {isEditing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Save</Text>
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
            <Text style={styles.modalTitle}>Delete Payment?</Text>
            <Text style={styles.modalMessage}>
              This will permanently delete the {deletePayment && formatCurrency(deletePayment.amount)} payment from {deletePayment && formatDate(deletePayment.payment_date)}.
            </Text>

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setDeletePayment(null)}
                disabled={isDeleting}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalDeleteButton]}
                onPress={confirmDeletePayment}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Delete</Text>
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
          onShareCreated={fetchBillData}
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
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
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
});
