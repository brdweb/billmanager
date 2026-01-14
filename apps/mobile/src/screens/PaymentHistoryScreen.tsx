import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Pressable,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { ChevronLeft, ChevronRight, Calendar, Users } from 'lucide-react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { api } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { Payment } from '../types';

type Props = NativeStackScreenProps<any, 'PaymentHistory'>;

export default function PaymentHistoryScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'expense' | 'deposit'>('all');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<Payment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editModal, setEditModal] = useState<Payment | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const swipeableRefs = useRef<Map<number, Swipeable>>(new Map());

  const fetchData = useCallback(async () => {
    try {
      // API returns enriched payments with bill_name, bill_type, is_share_payment, etc.
      const paymentsRes = await api.getAllPayments();

      if (paymentsRes.success && paymentsRes.data) {
        // Payments are already sorted by API, but ensure descending order
        const sortedPayments = [...paymentsRes.data].sort((a, b) =>
          new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
        );

        setPayments(sortedPayments);
        setError(null);
      } else {
        setError(paymentsRes.error || 'Failed to load payments');
      }
    } catch {
      setError('Network error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchData();
  }, [fetchData]);

  const prevMonth = () => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() - 1);
    setSelectedDate(newDate);
  };

  const nextMonth = () => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() + 1);
    setSelectedDate(newDate);
  };

  const handleSwipeDelete = (payment: Payment) => {
    // Close the swipeable and show confirmation modal
    const ref = swipeableRefs.current.get(payment.id);
    ref?.close();
    setDeleteConfirmModal(payment);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmModal) return;

    setIsDeleting(true);
    const result = await api.deletePayment(deleteConfirmModal.id);
    setIsDeleting(false);

    if (result.success) {
      // Clean up ref for deleted payment to prevent memory leak
      swipeableRefs.current.delete(deleteConfirmModal.id);
      setDeleteConfirmModal(null);
      fetchData();
    } else {
      // Show error in the modal - we'll handle this inline
      setDeleteConfirmModal(null);
    }
  };

  const renderRightActions = (payment: Payment) => {
    return (
      <TouchableOpacity
        style={[styles.deleteAction, { backgroundColor: colors.danger }]}
        onPress={() => handleSwipeDelete(payment)}
      >
        <Text style={styles.deleteActionText}>Delete</Text>
      </TouchableOpacity>
    );
  };

  const handleSwipeEdit = (payment: Payment) => {
    const ref = swipeableRefs.current.get(payment.id);
    ref?.close();
    setEditAmount(payment.amount.toString());
    setEditNotes(payment.notes || '');
    setEditDate(new Date(payment.payment_date));
    setEditModal(payment);
  };

  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (date) {
      setEditDate(date);
    }
  };

  const formatEditDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  const confirmEdit = async () => {
    if (!editModal) return;

    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid payment amount');
      return;
    }

    setIsEditing(true);
    const result = await api.updatePayment(
      editModal.id,
      amount,
      formatEditDate(editDate),
      editNotes.trim() || undefined
    );
    setIsEditing(false);

    if (result.success) {
      setEditModal(null);
      fetchData();
    } else {
      Alert.alert('Error', result.error || 'Failed to update payment');
    }
  };

  const renderLeftActions = (payment: Payment) => {
    return (
      <TouchableOpacity
        style={[styles.editAction, { backgroundColor: colors.primary }]}
        onPress={() => handleSwipeEdit(payment)}
      >
        <Text style={styles.editActionText}>Edit</Text>
      </TouchableOpacity>
    );
  };

  const formatCurrency = (amount: number): string => {
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

  const formatMonthYear = (date: Date): string => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const filteredPayments = payments.filter(p => {
    // Type filter
    if (filter !== 'all' && p.bill_type !== filter) return false;

    // Date filter
    const paymentDate = new Date(p.payment_date + 'T00:00:00');
    return (
      paymentDate.getMonth() === selectedDate.getMonth() &&
      paymentDate.getFullYear() === selectedDate.getFullYear()
    );
  });

  const renderPayment = ({ item }: { item: Payment }) => {
    const isDeposit = item.bill_type === 'deposit';
    const isSharePayment = item.is_share_payment;
    const isReceivedPayment = item.is_received_payment;

    return (
      <Swipeable
        ref={(ref) => {
          if (ref) {
            swipeableRefs.current.set(item.id, ref);
          }
        }}
        renderRightActions={() => renderRightActions(item)}
        renderLeftActions={() => renderLeftActions(item)}
        rightThreshold={40}
        leftThreshold={40}
        overshootRight={false}
        overshootLeft={false}
      >
        <View style={[
          styles.paymentCard,
          { backgroundColor: colors.surface },
          isSharePayment && styles.sharedPaymentCard,
          isSharePayment && { borderLeftColor: isReceivedPayment ? colors.success : colors.primary }
        ]}>
          <View style={styles.paymentInfo}>
            <View style={styles.billNameRow}>
              <Text style={[styles.billName, { color: colors.text }]}>{item.bill_name || 'Unknown Bill'}</Text>
              {isSharePayment && (
                <View style={[
                  styles.shareBadge,
                  { backgroundColor: isReceivedPayment ? colors.success + '20' : colors.primary + '20' }
                ]}>
                  <Users size={10} color={isReceivedPayment ? colors.success : colors.primary} />
                  <Text style={[
                    styles.shareBadgeText,
                    { color: isReceivedPayment ? colors.success : colors.primary }
                  ]}>
                    {isReceivedPayment ? 'Received' : 'Shared'}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.paymentDate, { color: colors.textMuted }]}>
              {formatDate(item.payment_date)}
            </Text>
            {item.notes && (
              <Text style={[styles.paymentNotes, { color: colors.textMuted }]} numberOfLines={1}>
                {item.notes}
              </Text>
            )}
          </View>
          <Text style={[
            styles.paymentAmount,
            { color: isDeposit ? colors.success : colors.danger }
          ]}>
            {isDeposit ? '+' : '-'}{formatCurrency(item.amount)}
          </Text>
        </View>
      </Swipeable>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={[styles.backButtonText, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        
        <View style={styles.monthSelector}>
          <TouchableOpacity onPress={prevMonth} style={styles.arrowButton}>
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{formatMonthYear(selectedDate)}</Text>
          <TouchableOpacity onPress={nextMonth} style={styles.arrowButton}>
            <ChevronRight size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.placeholder} />
      </View>

      {/* Filter Tabs */}
      <View style={[styles.filterContainer, { backgroundColor: colors.surface }]}>
        <TouchableOpacity
          style={[
            styles.filterButton,
            { backgroundColor: colors.background },
            filter === 'all' && { backgroundColor: colors.primary },
          ]}
          onPress={() => setFilter('all')}
        >
          <Text style={[
            styles.filterButtonText,
            { color: colors.text },
            filter === 'all' && { color: '#fff' },
          ]}>
            All
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.filterButton,
            { backgroundColor: colors.background },
            filter === 'expense' && { backgroundColor: colors.danger },
          ]}
          onPress={() => setFilter('expense')}
        >
          <Text style={[
            styles.filterButtonText,
            { color: colors.text },
            filter === 'expense' && { color: '#fff' },
          ]}>
            Expenses
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.filterButton,
            { backgroundColor: colors.background },
            filter === 'deposit' && { backgroundColor: colors.success },
          ]}
          onPress={() => setFilter('deposit')}
        >
          <Text style={[
            styles.filterButtonText,
            { color: colors.text },
            filter === 'deposit' && { color: '#fff' },
          ]}>
            Income
          </Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={fetchData}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredPayments}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderPayment}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No payments in {formatMonthYear(selectedDate)}
              </Text>
              <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
                Select a different month or add a payment
              </Text>
            </View>
          }
          ListFooterComponent={
            filteredPayments.length > 0 ? (
              <Text style={[styles.hint, { color: colors.textMuted }]}>
                Swipe left to delete • Swipe right to edit
              </Text>
            ) : null
          }
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        visible={deleteConfirmModal !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setDeleteConfirmModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Delete Payment?</Text>
            <Text style={[styles.modalMessage, { color: colors.textMuted }]}>
              This will permanently delete the {deleteConfirmModal && formatCurrency(deleteConfirmModal.amount)} payment for "{deleteConfirmModal?.bill_name}".
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.border }]}
                onPress={() => setDeleteConfirmModal(null)}
                disabled={isDeleting}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.deleteButton, { backgroundColor: colors.danger }]}
                onPress={confirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#fff' }]}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Payment Modal */}
      <Modal
        visible={editModal !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setEditModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Payment</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
              {editModal?.bill_name}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Date</Text>
              <TouchableOpacity
                style={[styles.input, styles.dateInput, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={() => setShowDatePicker(true)}
                disabled={isEditing}
              >
                <Calendar size={18} color={colors.textMuted} />
                <Text style={[styles.dateInputText, { color: colors.text }]}>
                  {editDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={editDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleDateChange}
                  maximumDate={new Date()}
                />
              )}
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Amount</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                value={editAmount}
                onChangeText={setEditAmount}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                editable={!isEditing}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, styles.notesInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
                value={editNotes}
                onChangeText={setEditNotes}
                placeholder="Add notes..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
                editable={!isEditing}
              />
            </View>

            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.border }]}
                onPress={() => setEditModal(null)}
                disabled={isEditing}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, { backgroundColor: colors.primary }]}
                onPress={confirmEdit}
                disabled={isEditing}
              >
                {isEditing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#fff' }]}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  backButton: {
    padding: 8,
    width: 40,
  },
  backButtonText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  monthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  arrowButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  placeholder: {
    width: 40,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  totalHeader: {
    fontSize: 14,
    marginBottom: 16,
  },
  monthSection: {
    marginBottom: 24,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: '600',
  },
  monthTotal: {
    fontSize: 13,
  },
  paymentCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  sharedPaymentCard: {
    borderLeftWidth: 3,
  },
  paymentInfo: {
    flex: 1,
    marginRight: 12,
  },
  billNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  billName: {
    fontSize: 15,
    fontWeight: '600',
  },
  shareBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  shareBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  paymentDate: {
    fontSize: 12,
    marginTop: 2,
  },
  paymentNotes: {
    fontSize: 12,
    marginTop: 2,
    fontStyle: 'italic',
  },
  paymentAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 16,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 40,
  },
  emptyText: {
    fontSize: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
  },
  hint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginBottom: 8,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
  },
  deleteActionText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  editAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginBottom: 8,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
  },
  editActionText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {},
  deleteButton: {},
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dateInputText: {
    fontSize: 16,
  },
});
