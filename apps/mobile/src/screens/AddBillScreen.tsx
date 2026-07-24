import React, { useMemo, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useMobileRuntime } from '../context/MobileRuntimeContext';
import { Bill, type BillFrequency, type BillFrequencyType } from '../types';
import IconPicker from '../components/IconPicker';
import { BillIcon } from '../components/BillIcon';
import {
  BILL_FREQUENCY_OPTIONS,
  billFrequencyFields,
  frequencyTypeForSelection,
} from '../features/bills/formModels';
import { billMoveChanges } from '../features/bills/listModels';
import { getMoneyInputProps, parseMoneyInput } from '../i18n/format';

type Props = NativeStackScreenProps<any, 'AddBill'>;

const WEEKDAYS = [
  { labelKey: 'common.weekdaysShort.mon', value: 0 },
  { labelKey: 'common.weekdaysShort.tue', value: 1 },
  { labelKey: 'common.weekdaysShort.wed', value: 2 },
  { labelKey: 'common.weekdaysShort.thu', value: 3 },
  { labelKey: 'common.weekdaysShort.fri', value: 4 },
  { labelKey: 'common.weekdaysShort.sat', value: 5 },
  { labelKey: 'common.weekdaysShort.sun', value: 6 },
];

const REMINDER_OPTIONS = [0, 1, 3, 7, 14, 30];

function parseFrequencyConfig(value?: string): { dates?: number[]; days?: number[] } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default function AddBillScreen({ navigation, route }: Props) {
  const { t, i18n } = useTranslation();
  const editBill = route.params?.bill as Bill | undefined;
  const isEditing = !!editBill;
  const { colors, isDark } = useTheme();
  const { currentDatabase, databases } = useAuth();
  const { bills, createBill, updateBill } = useMobileRuntime();
  const isAllBucketsMode = currentDatabase === '_all_';
  const initialFrequencyConfig = useMemo(
    () => parseFrequencyConfig(editBill?.frequency_config),
    [editBill?.frequency_config],
  );

  const [name, setName] = useState(editBill?.name || '');
  const [amount, setAmount] = useState(editBill?.amount?.toString() || '');
  const [varies, setVaries] = useState(editBill?.varies || false);
  const [frequency, setFrequency] = useState<BillFrequency>(editBill?.frequency || 'monthly');
  const [frequencyType, setFrequencyType] = useState<BillFrequencyType>(editBill?.frequency_type || 'simple');
  const [monthlyDates, setMonthlyDates] = useState(
    initialFrequencyConfig.dates?.join(', ') ?? '',
  );
  const [weeklyDays, setWeeklyDays] = useState<number[]>(initialFrequencyConfig.days ?? []);
  const [nextDue, setNextDue] = useState<Date>(() => {
    if (editBill?.next_due) {
      return new Date(editBill.next_due + 'T00:00:00');
    }
    return new Date();
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [type, setType] = useState<'expense' | 'deposit'>(editBill?.type || 'expense');
  const [account, setAccount] = useState(editBill?.account || '');
  const [category, setCategory] = useState(editBill?.category || '');
  const [notes, setNotes] = useState(editBill?.notes || '');
  const [autoPayment, setAutoPayment] = useState(editBill?.auto_payment || false);
  const [reminderEnabled, setReminderEnabled] = useState(editBill?.reminder_enabled ?? true);
  const [reminderDays, setReminderDays] = useState<number[]>(
    editBill?.reminder_days?.length ? editBill.reminder_days : [0, 1, 3, 7],
  );
  const [icon, setIcon] = useState(editBill?.icon || 'receipt');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<number | null>(
    editBill?.database_id || null
  );
  const accounts = useMemo(
    () => [...new Set(bills.map((bill) => bill.account).filter((value): value is string => Boolean(value)))],
    [bills],
  );
  const categories = useMemo(
    () => [...new Set(bills.map((bill) => bill.category).filter((value): value is string => Boolean(value)))],
    [bills],
  );

  const styles = createStyles(colors);
  const moneyInputProps = getMoneyInputProps();

  function formatDateForDisplay(date: Date): string {
    return date.toLocaleDateString(i18n.resolvedLanguage ?? i18n.language, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatDateForApi(date: Date): string {
    // Use local date components to avoid UTC timezone shift
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setNextDue(selectedDate);
    }
  };

  async function handleSubmit() {
    if (!name.trim()) {
      Alert.alert(t('mobileParity.common.error'), t('billModal.errors.nameRequired'));
      return;
    }

    if (!varies && !amount) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.addBill.errors.amountRequired'));
      return;
    }

    const parsedAmount = varies ? null : parseMoneyInput(amount);
    if (!varies && parsedAmount === null) {
      Alert.alert(t('mobileParity.common.error'), t('mobileParity.billDetail.invalidAmount'));
      return;
    }

    // Validate bucket selection when creating in All Buckets mode
    if (!isEditing && isAllBucketsMode && !selectedDatabaseId) {
      Alert.alert(t('mobileParity.common.error'), t('billModal.errors.bucketRequired'));
      return;
    }

    const specificDates = monthlyDates
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
    if (frequency === 'monthly' && frequencyType === 'specific_dates') {
      const invalid = specificDates.length === 0
        || specificDates.some((value) => value < 1 || value > 31);
      if (invalid) {
        Alert.alert(t('mobileParity.addBill.errors.invalidSchedule'), t('mobileParity.addBill.errors.monthDates'));
        return;
      }
    }
    if (frequency === 'custom' && weeklyDays.length === 0) {
      Alert.alert(t('mobileParity.addBill.errors.invalidSchedule'), t('mobileParity.addBill.errors.weekday'));
      return;
    }

    setIsSubmitting(true);

    let nextDueValue = formatDateForApi(nextDue);
    if (frequency === 'monthly' && frequencyType === 'specific_dates') {
      const now = new Date();
      const nextDay = specificDates.find((day) => day > now.getDate());
      const year = nextDay ? now.getFullYear() : (now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear());
      const month = nextDay ? now.getMonth() : (now.getMonth() + 1) % 12;
      const requestedDay = nextDay ?? specificDates[0];
      const maximumDay = new Date(year, month + 1, 0).getDate();
      nextDueValue = formatDateForApi(new Date(year, month, Math.min(requestedDay, maximumDay)));
    }

    const normalizedFrequency = billFrequencyFields(
      frequency,
      frequencyType,
      specificDates,
      weeklyDays,
    );

    const billData: Partial<Bill> = {
      name: name.trim(),
      amount: parsedAmount,
      varies,
      frequency,
      ...normalizedFrequency,
      next_due: nextDueValue,
      type,
      account: account.trim() || null,
      category: category.trim() || null,
      notes: notes.trim() || null,
      auto_payment: autoPayment,
      reminder_enabled: reminderEnabled,
      reminder_days: reminderDays,
      icon,
      // Include database_id if creating in All Buckets mode or moving to different bucket
      ...(selectedDatabaseId ? billMoveChanges(selectedDatabaseId) : {}),
    };

    try {
      if (isEditing && editBill) {
        await updateBill(editBill, billData);
      } else {
        await createBill(billData);
      }
      navigation.goBack();
    } catch (err) {
      Alert.alert(t('mobileParity.addBill.errors.saveTitle'), err instanceof Error ? err.message : t('mobileParity.addBill.errors.saveBody'));
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
          <Text style={styles.cancelText}>{t('mobileParity.common.cancel')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditing ? t('billModal.titleEdit') : t('mobileParity.addBill.newTitle')}</Text>
        <TouchableOpacity onPress={handleSubmit} disabled={isSubmitting} style={styles.headerButton}>
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.saveText}>{t('mobileParity.common.save')}</Text>
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
            ]}>{t('mobileParity.addBill.expense')}</Text>
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
            ]}>{t('mobileParity.addBill.income')}</Text>
          </TouchableOpacity>
        </View>

        {/* Name & Icon */}
        <Text style={styles.label}>{t('mobileParity.addBill.nameIcon')}</Text>
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
            placeholder={t('billModal.billNamePlaceholder')}
            placeholderTextColor={colors.textMuted}
          />
        </View>

        {/* Amount */}
        <View style={styles.amountRow}>
          <View style={styles.amountInputContainer}>
            <Text style={styles.label}>{t('billModal.amountLabel')}</Text>
            <TextInput
              style={[styles.input, varies && styles.inputDisabled]}
              value={amount}
              onChangeText={setAmount}
              {...moneyInputProps}
              placeholderTextColor={colors.textMuted}
              editable={!varies}
            />
          </View>
          <View style={styles.variableContainer}>
            <Text style={styles.label}>{t('mobileParity.addBill.variable')}</Text>
            <Switch
              value={varies}
              onValueChange={setVaries}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Frequency */}
        <Text style={styles.label}>{t('billModal.frequencyLabel')}</Text>
        <View style={styles.frequencyContainer}>
          {BILL_FREQUENCY_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.frequencyButton,
                frequency === option.value && styles.frequencyButtonActive,
              ]}
              onPress={() => {
                setFrequency(option.value);
                setFrequencyType(frequencyTypeForSelection(option.value));
              }}
            >
              <Text style={[
                styles.frequencyButtonText,
                frequency === option.value && styles.frequencyButtonTextActive,
              ]}>{t(option.labelKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {frequency === 'monthly' && (
          <View style={styles.schedulePanel}>
            <View style={styles.switchRowCompact}>
              <View style={styles.switchCopy}>
                <Text style={styles.switchTitle}>{t('mobileParity.addBill.useSpecificDates')}</Text>
                <Text style={styles.switchDescription}>{t('mobileParity.addBill.specificDatesDetail')}</Text>
              </View>
              <Switch
                value={frequencyType === 'specific_dates'}
                onValueChange={(enabled) => setFrequencyType(enabled ? 'specific_dates' : 'simple')}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
            {frequencyType === 'specific_dates' && (
              <TextInput
                style={styles.input}
                value={monthlyDates}
                onChangeText={setMonthlyDates}
                keyboardType="numbers-and-punctuation"
                placeholder={t('billModal.datesPlaceholder')}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={t('mobileParity.addBill.specificDatesA11y')}
              />
            )}
          </View>
        )}

        {frequency === 'custom' && (
          <View style={styles.schedulePanel}>
            <Text style={styles.switchTitle}>{t('billModal.daysOfWeek')}</Text>
            <View style={styles.dayContainer}>
              {WEEKDAYS.map((day) => {
                const selected = weeklyDays.includes(day.value);
                return (
                  <TouchableOpacity
                    key={day.value}
                    style={[styles.dayButton, selected && styles.frequencyButtonActive]}
                    onPress={() => setWeeklyDays((current) => selected
                      ? current.filter((value) => value !== day.value)
                      : [...current, day.value])}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <Text style={[styles.frequencyButtonText, selected && styles.frequencyButtonTextActive]}>
                      {t(day.labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Next Due Date */}
        {frequencyType !== 'specific_dates' && (
          <>
            <Text style={styles.label}>{t('billModal.nextDueLabel')}</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={styles.dateButtonText}>{formatDateForDisplay(nextDue)}</Text>
            </TouchableOpacity>
          </>
        )}

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
            <Text style={styles.doneButtonText}>{t('mobileParity.common.done')}</Text>
          </TouchableOpacity>
        )}

        {/* Account */}
        <Text style={styles.label}>{t('mobileParity.addBill.accountOptional')}</Text>
        <TextInput
          style={styles.input}
          value={account}
          onChangeText={setAccount}
          placeholder={t('billModal.accountPlaceholder')}
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

        {/* Category */}
        <Text style={styles.label}>{t('mobileParity.addBill.categoryOptional')}</Text>
        <TextInput
          style={styles.input}
          value={category}
          onChangeText={setCategory}
          placeholder={t('billModal.categoryPlaceholder')}
          placeholderTextColor={colors.textMuted}
        />
        {categories.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountSuggestions}>
            {categories.map((item) => (
              <TouchableOpacity key={item} style={styles.accountChip} onPress={() => setCategory(item)}>
                <Text style={styles.accountChipText}>{item}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Bucket selector - shown when creating in All Buckets mode or editing */}
        {(isAllBucketsMode || isEditing) && databases.length > 0 && (
          <>
            <Text style={styles.label}>
              {!isEditing && isAllBucketsMode ? t('mobileParity.addBill.bucketRequired') : t('billModal.bucketLabel')}
            </Text>
            <View style={styles.bucketContainer}>
              {databases.map((db) => (
                <TouchableOpacity
                  key={db.id}
                  style={[
                    styles.bucketButton,
                    selectedDatabaseId === db.id && styles.bucketButtonActive,
                  ]}
                  onPress={() => setSelectedDatabaseId(db.id)}
                >
                  <Text style={[
                    styles.bucketButtonText,
                    selectedDatabaseId === db.id && styles.bucketButtonTextActive,
                  ]}>{db.display_name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!isEditing && isAllBucketsMode && (
              <Text style={styles.bucketHint}>{t('billModal.bucketDescriptionCreate')}</Text>
            )}
            {isEditing && (
              <Text style={styles.bucketHint}>{t('billModal.bucketDescriptionMove')}</Text>
            )}
          </>
        )}

        {/* Auto-payment */}
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('mobileParity.addBill.autoPayment')}</Text>
          <Switch
            value={autoPayment}
            onValueChange={setAutoPayment}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchLabel}>{t('mobileParity.addBill.localReminders')}</Text>
            <Text style={styles.switchDescription}>{t('mobileParity.addBill.localRemindersDetail')}</Text>
          </View>
          <Switch
            value={reminderEnabled}
            onValueChange={setReminderEnabled}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        {reminderEnabled && (
          <>
            <Text style={styles.label}>{t('mobileParity.addBill.remindMe')}</Text>
            <View style={styles.frequencyContainer}>
              {REMINDER_OPTIONS.map((day) => {
                const selected = reminderDays.includes(day);
                const label = day === 0 ? t('mobileParity.addBill.dueDay') : t('mobileParity.addBill.dayBefore', { count: day });
                return (
                  <TouchableOpacity
                    key={day}
                    style={[styles.frequencyButton, selected && styles.frequencyButtonActive]}
                    onPress={() => setReminderDays((current) => selected
                      ? current.filter((value) => value !== day)
                      : [...current, day].sort((left, right) => left - right))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <Text style={[styles.frequencyButtonText, selected && styles.frequencyButtonTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* Notes */}
        <Text style={styles.label}>{t('mobileParity.addBill.notesOptional')}</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('billModal.notesPlaceholder')}
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
  schedulePanel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    marginTop: 12,
  },
  switchRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchCopy: {
    flex: 1,
  },
  switchTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  switchDescription: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  dayContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  dayButton: {
    minWidth: 42,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.border,
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
  bucketContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bucketButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bucketButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  bucketButtonText: {
    fontSize: 14,
    color: colors.text,
  },
  bucketButtonTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  bucketHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
    fontStyle: 'italic',
  },
});
