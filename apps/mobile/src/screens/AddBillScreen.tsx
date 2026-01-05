import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { Bill } from '../types';
import IconPicker from '../components/IconPicker';
import { BillIcon } from '../components/BillIcon';

type Props = NativeStackScreenProps<any, 'AddBill'>;

const FREQUENCY_OPTIONS = [
  { label: 'Monthly', value: 'monthly' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Bi-weekly', value: 'biweekly' },
  { label: 'Quarterly', value: 'quarterly' },
  { label: 'Yearly', value: 'yearly' },
  { label: 'One-time', value: 'once' },
];

export default function AddBillScreen({ navigation, route }: Props) {
  const editBill = route.params?.bill as Bill | undefined;
  const isEditing = !!editBill;
  const { colors, isDark } = useTheme();

  const [name, setName] = useState(editBill?.name || '');
  const [amount, setAmount] = useState(editBill?.amount?.toString() || '');
  const [varies, setVaries] = useState(editBill?.varies || false);
  const [frequency, setFrequency] = useState(editBill?.frequency || 'monthly');
  const [nextDue, setNextDue] = useState<Date>(() => {
    if (editBill?.next_due) {
      return new Date(editBill.next_due + 'T00:00:00');
    }
    return new Date();
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [type, setType] = useState<'expense' | 'deposit'>(editBill?.type || 'expense');
  const [account, setAccount] = useState(editBill?.account || '');
  const [notes, setNotes] = useState(editBill?.notes || '');
  const [autoPayment, setAutoPayment] = useState(editBill?.auto_payment || false);
  const [icon, setIcon] = useState(editBill?.icon || 'receipt');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);

  const styles = createStyles(colors);

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    try {
      const response = await api.getBills();
      if (response.success && response.data) {
        const uniqueAccounts = [
          ...new Set(
            response.data
              .map((b) => b.account)
              .filter((a): a is string => !!a)
          ),
        ];
        setAccounts(uniqueAccounts);
      }
    } catch (err) {
      // Ignore
    }
  }

  function formatDateForDisplay(date: Date): string {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatDateForApi(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setNextDue(selectedDate);
    }
  };

  async function handleSubmit() {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a bill name');
      return;
    }

    if (!varies && !amount) {
      Alert.alert('Error', 'Please enter an amount or mark as variable');
      return;
    }

    setIsSubmitting(true);

    const billData: Partial<Bill> = {
      name: name.trim(),
      amount: varies ? null : parseFloat(amount),
      varies,
      frequency,
      next_due: formatDateForApi(nextDue),
      type,
      account: account.trim() || null,
      notes: notes.trim() || null,
      auto_payment: autoPayment,
      icon,
    };

    try {
      let result;
      if (isEditing && editBill) {
        result = await api.updateBill(editBill.id, billData);
      } else {
        result = await api.createBill(billData);
      }

      if (result.success) {
        navigation.goBack();
      } else {
        Alert.alert('Error', result.error || 'Failed to save bill');
      }
    } catch (err) {
      Alert.alert('Error', 'Network error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditing ? 'Edit Bill' : 'New Bill'}</Text>
        <TouchableOpacity onPress={handleSubmit} disabled={isSubmitting} style={styles.headerButton}>
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.saveText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        {/* Type Toggle */}
        <View style={styles.typeToggle}>
          <TouchableOpacity
            style={[
              styles.typeButton,
              type === 'expense' && styles.typeButtonExpenseActive,
            ]}
            onPress={() => setType('expense')}
          >
            <Text style={[
              styles.typeButtonText,
              type === 'expense' && styles.typeButtonTextActive,
            ]}>Expense</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.typeButton,
              type === 'deposit' && styles.typeButtonDepositActive,
            ]}
            onPress={() => setType('deposit')}
          >
            <Text style={[
              styles.typeButtonText,
              type === 'deposit' && styles.typeButtonTextActive,
            ]}>Income</Text>
          </TouchableOpacity>
        </View>

        {/* Name & Icon */}
        <Text style={styles.label}>Name & Icon</Text>
        <View style={styles.nameRow}>
          <TouchableOpacity 
            style={styles.iconButton}
            onPress={() => setShowIconPicker(true)}
          >
            <BillIcon icon={icon} size={28} color={type === 'deposit' ? colors.success : colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={[styles.input, styles.nameInput]}
            value={name}
            onChangeText={setName}
            placeholder="e.g., Electric Bill"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        {/* Amount */}
        <View style={styles.amountRow}>
          <View style={styles.amountInputContainer}>
            <Text style={styles.label}>Amount</Text>
            <TextInput
              style={[styles.input, varies && styles.inputDisabled]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              editable={!varies}
            />
          </View>
          <View style={styles.variableContainer}>
            <Text style={styles.label}>Variable</Text>
            <Switch
              value={varies}
              onValueChange={setVaries}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Frequency */}
        <Text style={styles.label}>Frequency</Text>
        <View style={styles.frequencyContainer}>
          {FREQUENCY_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.frequencyButton,
                frequency === option.value && styles.frequencyButtonActive,
              ]}
              onPress={() => setFrequency(option.value)}
            >
              <Text style={[
                styles.frequencyButtonText,
                frequency === option.value && styles.frequencyButtonTextActive,
              ]}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Next Due Date */}
        <Text style={styles.label}>Next Due Date</Text>
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => setShowDatePicker(true)}
        >
          <Text style={styles.dateButtonText}>{formatDateForDisplay(nextDue)}</Text>
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker
            value={nextDue}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleDateChange}
            themeVariant={isDark ? 'dark' : 'light'}
          />
        )}

        {Platform.OS === 'ios' && showDatePicker && (
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => setShowDatePicker(false)}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        )}

        {/* Account */}
        <Text style={styles.label}>Account (optional)</Text>
        <TextInput
          style={styles.input}
          value={account}
          onChangeText={setAccount}
          placeholder="e.g., Chase Checking"
          placeholderTextColor={colors.textMuted}
        />
        {accounts.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountSuggestions}>
            {accounts.map((acc) => (
              <TouchableOpacity
                key={acc}
                style={styles.accountChip}
                onPress={() => setAccount(acc)}
              >
                <Text style={styles.accountChipText}>{acc}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Auto-payment */}
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Auto-payment enabled</Text>
          <Switch
            value={autoPayment}
            onValueChange={setAutoPayment}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        {/* Notes */}
        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Any additional notes..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Icon Picker Modal */}
      <IconPicker
        visible={showIconPicker}
        onClose={() => setShowIconPicker(false)}
        onSelect={setIcon}
        currentIcon={icon}
      />
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: colors.surface,
  },
  headerButton: {
    padding: 4,
    minWidth: 60,
  },
  cancelText: {
    color: colors.textMuted,
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  saveText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  label: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameInput: {
    flex: 1,
  },
  iconButton: {
    width: 50,
    height: 50,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputDisabled: {
    opacity: 0.5,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  typeToggle: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  typeButtonExpenseActive: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  typeButtonDepositActive: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  typeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  typeButtonTextActive: {
    color: '#fff',
  },
  amountRow: {
    flexDirection: 'row',
    gap: 16,
  },
  amountInputContainer: {
    flex: 1,
  },
  variableContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  frequencyContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  frequencyButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  frequencyButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  frequencyButtonText: {
    fontSize: 14,
    color: colors.text,
  },
  frequencyButtonTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  dateButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dateButtonText: {
    fontSize: 16,
    color: colors.text,
  },
  doneButton: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
  },
  doneButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  accountSuggestions: {
    marginTop: 8,
  },
  accountChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.border,
    marginRight: 8,
  },
  accountChipText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  switchLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
});