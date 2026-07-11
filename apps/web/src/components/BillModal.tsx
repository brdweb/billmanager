import { useEffect, useState } from 'react';
import {
  Modal,
  TextInput,
  Textarea,
  NumberInput,
  Select,
  MultiSelect,
  Switch,
  Button,
  Group,
  Stack,
  ActionIcon,
  Text,
  Checkbox,
  Paper,
  SimpleGrid,
  Divider,
  Autocomplete,
  Badge,
  Box,
} from '@mantine/core';
import { IconArchive, IconArchiveOff, IconTrash, IconShare } from '@tabler/icons-react';
import { DatePickerInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Bill, BillShare, Database } from '../api/client';
import * as api from '../api/client';
import { IconPicker } from './IconPicker';
import { BillIcon } from './BillIcon';
import { ShareBillModal } from './ShareBillModal';
import { formatDateForAPI, parseLocalDate } from '../utils/date';
import {
  getCurrencyInputPlaceholder,
  getCurrencyInputProps,
  getLocale,
} from '../lib/currency';

interface BillFormValues {
  name: string;
  amount: number | '';
  varies: boolean;
  frequency: string;
  frequency_type: string;
  monthly_dates: string;
  weekly_days: number[];
  next_due: Date | null;
  auto_payment: boolean;
  reminder_enabled: boolean;
  reminder_days: string[];
  icon: string;
  type: 'expense' | 'deposit';
  account: string | null;
  category: string | null;
  notes: string;
  database_id: number | null;
}

interface BillModalProps {
  opened: boolean;
  onClose: () => void;
  onSave: (bill: Partial<Bill>) => Promise<void>;
  onArchive?: (bill: Bill) => Promise<void>;
  onUnarchive?: (bill: Bill) => Promise<void>;
  onDelete?: (bill: Bill) => Promise<void>;
  bill: Bill | null;
  isAllBucketsMode?: boolean;
  databases?: Database[];
}

function getFrequencyOptions(t: TFunction) {
  return [
    { value: 'weekly', label: t('common.frequency.weekly') },
    { value: 'bi-weekly', label: t('common.frequency.biweekly') },
    { value: 'monthly', label: t('common.frequency.monthly') },
    { value: 'quarterly', label: t('common.frequency.quarterly') },
    { value: 'yearly', label: t('common.frequency.yearly') },
    { value: 'custom', label: t('billModal.frequencyCustomLabel') },
  ];
}

function getDayOptions(t: TFunction) {
  return [
    { label: t('common.weekdaysShort.mon'), value: 0 },
    { label: t('common.weekdaysShort.tue'), value: 1 },
    { label: t('common.weekdaysShort.wed'), value: 2 },
    { label: t('common.weekdaysShort.thu'), value: 3 },
    { label: t('common.weekdaysShort.fri'), value: 4 },
    { label: t('common.weekdaysShort.sat'), value: 5 },
    { label: t('common.weekdaysShort.sun'), value: 6 },
  ];
}

function getReminderDayOptions(t: TFunction) {
  return [
    { value: '0', label: t('billModal.reminderOptions.dueDay') },
    { value: '1', label: t('billModal.reminderOptions.oneDayBefore') },
    { value: '3', label: t('billModal.reminderOptions.threeDaysBefore') },
    { value: '7', label: t('billModal.reminderOptions.oneWeekBefore') },
    { value: '14', label: t('billModal.reminderOptions.twoWeeksBefore') },
    { value: '30', label: t('billModal.reminderOptions.thirtyDaysBefore') },
  ];
}

export function BillModal({ opened, onClose, onSave, onArchive, onUnarchive, onDelete, bill, isAllBucketsMode = false, databases = [] }: BillModalProps) {
  const { t } = useTranslation();
  const frequencyOptions = getFrequencyOptions(t);
  const dayOptions = getDayOptions(t);
  const reminderDayOptions = getReminderDayOptions(t);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [billShares, setBillShares] = useState<BillShare[]>([]);

  const form = useForm<BillFormValues>({
    initialValues: {
      name: '',
      amount: '',
      varies: false,
      frequency: 'monthly',
      frequency_type: 'simple',
      monthly_dates: '',
      weekly_days: [],
      next_due: null,
      auto_payment: false,
      reminder_enabled: true,
      reminder_days: ['0', '1', '3', '7'],
      icon: 'payment',
      type: 'expense',
      account: null,
      category: null,
      notes: '',
      database_id: null,
    },
    validate: {
      name: (value) => (!value.trim() ? t('billModal.errors.nameRequired') : null),
      next_due: (value, values) => {
        if (values.frequency === 'monthly' && values.frequency_type === 'specific_dates') {
          return null; // Not required for specific dates
        }
        return !value ? t('billModal.errors.dueDateRequired') : null;
      },
      monthly_dates: (value, values) => {
        if (values.frequency === 'monthly' && values.frequency_type === 'specific_dates') {
          if (!value.trim()) return t('billModal.errors.datesRequired');
          const dates = value.split(',').map((d) => parseInt(d.trim()));
          if (dates.some((d) => isNaN(d) || d < 1 || d > 31)) {
            return t('billModal.errors.datesInvalid');
          }
        }
        return null;
      },
      weekly_days: (value, values) => {
        if (values.frequency === 'custom' && values.frequency_type === 'multiple_weekly') {
          if (value.length === 0) return t('billModal.errors.daysRequired');
        }
        return null;
      },
    },
  });

  useEffect(() => {
    if (opened) {
      api.getAccounts()
        .then(response => {
          setAccounts(response);
        })
        .catch(() => {
          setAccounts([]); // Fallback to empty list instead of crashing
        });
      api.getCategories()
        .then(response => {
          setCategories(response);
        })
        .catch(() => {
          setCategories([]);
        });
    }
  }, [opened]);

  // Fetch bill shares when modal opens with an existing bill
  useEffect(() => {
    if (opened && bill?.id) {
      api.getBillShares(bill.id)
        .then(shares => {
          setBillShares(shares.filter(s => s.status === 'accepted'));
        })
        .catch(() => {
          setBillShares([]); // Fallback to empty list
        });
    } else {
      setBillShares([]);
    }
  }, [opened, bill?.id]);

  useEffect(() => {
    if (opened) {
      try {
        if (bill) {
          let frequencyConfig: { dates?: number[]; days?: number[] } = {};
          try {
            frequencyConfig = bill.frequency_config ? JSON.parse(bill.frequency_config) : {};
          } catch {
            // Fallback to empty config if parsing fails
          }

          form.setValues({
            name: bill.name || '',
            amount: bill.amount || '',
            varies: bill.varies || false,
            frequency: bill.frequency || 'monthly',
            frequency_type: bill.frequency_type || 'simple',
            monthly_dates: (frequencyConfig && frequencyConfig.dates) ? frequencyConfig.dates.join(', ') : '',
            weekly_days: (frequencyConfig && frequencyConfig.days) ? frequencyConfig.days : [],
            next_due: bill.next_due ? parseLocalDate(bill.next_due) : null,
            auto_payment: bill.auto_payment || false,
            reminder_enabled: bill.reminder_enabled ?? true,
            reminder_days: (bill.reminder_days && bill.reminder_days.length > 0 ? bill.reminder_days : [0, 1, 3, 7]).map(String),
            icon: bill.icon || 'payment',
            type: bill.type || 'expense',
            account: bill.account || null,
            category: bill.category || null,
            notes: bill.notes || '',
            database_id: bill.database_id || null,
          });
        } else {
          form.reset();
        }
      } catch {
        // Form initialization error - silent fail, form will be in default state
      }
    }
  }, [bill, opened]); // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate next due date for specific monthly dates
  const calculateNextDueForSpecificDates = (dates: number[]): string => {
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    // Find next date in current month
    const nextDateThisMonth = dates.find((d) => d > currentDay);
    if (nextDateThisMonth) {
      const nextDue = new Date(currentYear, currentMonth, nextDateThisMonth);
      return formatDateForAPI(nextDue);
    }

    // Otherwise, use first date of next month
    const nextMonth = currentMonth + 1;
    const nextYear = nextMonth > 11 ? currentYear + 1 : currentYear;
    const nextDue = new Date(nextYear, nextMonth % 12, dates[0]);
    return formatDateForAPI(nextDue);
  };

  const handleSubmit = async (values: BillFormValues) => {
    // Validate bucket selection when creating in All Buckets mode
    const isCreating = !bill;
    if (isCreating && isAllBucketsMode && !values.database_id) {
      form.setFieldError('database_id', t('billModal.errors.bucketRequired'));
      return;
    }

    setLoading(true);
    try {
      let frequencyConfig: { dates?: number[]; days?: number[] } = {};
      let calculatedNextDue: string | null = null;

      if (values.frequency === 'monthly' && values.frequency_type === 'specific_dates') {
        const dates = values.monthly_dates
          .split(',')
          .map((d) => parseInt(d.trim()))
          .filter((d) => !isNaN(d) && d >= 1 && d <= 31)
          .sort((a, b) => a - b);
        frequencyConfig = { dates };
        // Calculate the next occurrence for specific dates
        if (dates.length > 0) {
          calculatedNextDue = calculateNextDueForSpecificDates(dates);
        }
      } else if (values.frequency === 'custom' && values.frequency_type === 'multiple_weekly') {
        frequencyConfig = { days: values.weekly_days.sort((a, b) => a - b) };
      }

      // Determine next_due: use calculated value for specific_dates, otherwise use form value
      let nextDue: string;
      if (calculatedNextDue) {
        nextDue = calculatedNextDue;
      } else if (values.next_due) {
        nextDue = values.next_due instanceof Date
          ? formatDateForAPI(values.next_due)
          : String(values.next_due).split('T')[0];
      } else {
        nextDue = formatDateForAPI(new Date());
      }

      const billData: Partial<Bill> = {
        name: values.name,
        amount: values.varies ? null : (values.amount as number),
        varies: values.varies,
        frequency: values.frequency as Bill['frequency'],
        frequency_type: values.frequency_type as Bill['frequency_type'],
        frequency_config: JSON.stringify(frequencyConfig),
        next_due: nextDue,
        auto_payment: values.auto_payment,
        reminder_enabled: values.reminder_enabled,
        reminder_days: values.reminder_days.map((day) => Number(day)),
        icon: values.icon,
        type: values.type,
        account: values.account || null,
        category: values.category || null,
        notes: values.notes.trim() || null,
        // Include database_id if creating in All Buckets mode or moving to a different bucket
        ...(values.database_id ? { database_id: values.database_id } : {}),
      };

      await onSave(billData);
      window.umami?.track(bill ? 'bill_updated' : 'bill_created', { type: values.type });
      onClose();
    } catch {
      // Error is already handled by App.tsx with notification
      // Just keep the modal open so user can try again
    } finally {
      setLoading(false);
    }
  };

  const showMonthlyOptions = form.values.frequency === 'monthly';
  const showCustomOptions = form.values.frequency === 'custom';
  const showSpecificDates =
    showMonthlyOptions && form.values.frequency_type === 'specific_dates';

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={bill ? t('billModal.titleEdit') : t('billModal.titleAdd')}
        size="lg"
        centered
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            {/* Row 1: Name and Icon */}
            <Group grow align="flex-start">
              <TextInput
                label={t('billModal.billNameLabel')}
                placeholder={t('billModal.billNamePlaceholder')}
                required
                {...form.getInputProps('name')}
              />
              <div>
                <Text size="sm" fw={500} mb={4}>
                  {t('billModal.iconLabel')}
                </Text>
                <ActionIcon
                  variant="light"
                  size="xl"
                  onClick={() => setIconPickerOpen(true)}
                >
                  <BillIcon icon={form.values.icon} size={24} />
                </ActionIcon>
              </div>
            </Group>

            {/* Row 2: Type and Account */}
            <Group grow align="flex-end">
              <Select
                label={t('billModal.typeLabel')}
                data={[
                  { value: 'expense', label: t('billModal.typeExpense') },
                  { value: 'deposit', label: t('billModal.typeDeposit') }
                ]}
                {...form.getInputProps('type')}
              />
              <Autocomplete
                label={t('billModal.accountLabel')}
                placeholder={t('billModal.accountPlaceholder')}
                data={accounts}
                value={form.values.account || ''}
                onChange={(value) => form.setFieldValue('account', value || null)}
                limit={5}
              />
            </Group>

            <Autocomplete
              label={t('billModal.categoryLabel')}
              placeholder={t('billModal.categoryPlaceholder')}
              data={categories}
              value={form.values.category || ''}
              onChange={(value) => form.setFieldValue('category', value || null)}
              limit={8}
            />

            {/* Bucket selector - shown when creating in All Buckets mode or editing any bill */}
            {(isAllBucketsMode || bill) && databases.length > 0 && (
              <Select
                label={t('billModal.bucketLabel')}
                placeholder={!bill && isAllBucketsMode ? t('billModal.bucketPlaceholderCreate') : t('billModal.bucketPlaceholderMove')}
                description={!bill && isAllBucketsMode ? t('billModal.bucketDescriptionCreate') : t('billModal.bucketDescriptionMove')}
                data={databases.map((db) => ({
                  value: String(db.id),
                  label: db.display_name,
                }))}
                value={form.values.database_id ? String(form.values.database_id) : null}
                onChange={(value) => form.setFieldValue('database_id', value ? parseInt(value) : null)}
                required={!bill && isAllBucketsMode}
                error={form.errors.database_id}
                clearable={!!bill}
              />
            )}

            {/* Row 3: Amount and Varies */}
            <Group grow align="flex-end">
              <NumberInput
                label={t('billModal.amountLabel')}
                placeholder={getCurrencyInputPlaceholder()}
                {...getCurrencyInputProps()}
                fixedDecimalScale
                disabled={form.values.varies}
                {...form.getInputProps('amount')}
              />
              <Switch
                label={t('billModal.amountVariesLabel')}
                checked={form.values.varies}
                onChange={(event) =>
                  form.setFieldValue('varies', event.currentTarget.checked)
                }
              />
            </Group>

            {/* Row 3: Frequency */}
            <Select
              label={t('billModal.frequencyLabel')}
              data={frequencyOptions}
              {...form.getInputProps('frequency')}
              onChange={(value) => {
                form.setFieldValue('frequency', value || 'monthly');
                if (value === 'custom') {
                  form.setFieldValue('frequency_type', 'multiple_weekly');
                } else if (value === 'monthly') {
                  form.setFieldValue('frequency_type', 'simple');
                } else {
                  form.setFieldValue('frequency_type', 'simple');
                }
              }}
            />

            {/* Monthly specific options */}
            {showMonthlyOptions && (
              <Paper p="md" withBorder>
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    {t('billModal.monthlySchedule')}
                  </Text>
                  <Group>
                    <Switch
                      label={t('billModal.useSpecificDates')}
                      checked={form.values.frequency_type === 'specific_dates'}
                      onChange={(event) =>
                        form.setFieldValue(
                          'frequency_type',
                          event.currentTarget.checked ? 'specific_dates' : 'simple'
                        )
                      }
                    />
                  </Group>
                  {showSpecificDates && (
                    <TextInput
                      label={t('billModal.datesLabel')}
                      placeholder={t('billModal.datesPlaceholder')}
                      description={t('billModal.datesDescription')}
                      {...form.getInputProps('monthly_dates')}
                    />
                  )}
                </Stack>
              </Paper>
            )}

            {/* Custom weekly options */}
            {showCustomOptions && (
              <Paper p="md" withBorder>
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    {t('billModal.daysOfWeek')}
                  </Text>
                  <SimpleGrid cols={7}>
                    {dayOptions.map((day) => (
                      <Checkbox
                        key={day.value}
                        label={day.label}
                        checked={form.values.weekly_days.includes(day.value)}
                        onChange={(event) => {
                          const days = event.currentTarget.checked
                            ? [...form.values.weekly_days, day.value]
                            : form.values.weekly_days.filter((d) => d !== day.value);
                          form.setFieldValue('weekly_days', days);
                        }}
                      />
                    ))}
                  </SimpleGrid>
                  {form.errors.weekly_days && (
                    <Text size="xs" c="red">
                      {form.errors.weekly_days}
                    </Text>
                  )}
                </Stack>
              </Paper>
            )}

            {/* Due Date */}
            {!showSpecificDates && (
              <DatePickerInput
                label={t('billModal.nextDueLabel')}
                placeholder={t('billModal.nextDuePlaceholder')}
                required
                valueFormat={t('common.dateInputFormat')}
                {...form.getInputProps('next_due')}
              />
            )}

            {/* Auto Payment */}
            <Switch
              label={t('billModal.autoPaymentLabel')}
              description={t('billModal.autoPaymentDescription')}
              checked={form.values.auto_payment}
              onChange={(event) =>
                form.setFieldValue('auto_payment', event.currentTarget.checked)
              }
            />

            <Switch
              label={t('billModal.remindersLabel')}
              description={t('billModal.remindersDescription')}
              checked={form.values.reminder_enabled}
              onChange={(event) =>
                form.setFieldValue('reminder_enabled', event.currentTarget.checked)
              }
            />

            {form.values.reminder_enabled && (
              <MultiSelect
                label={t('billModal.reminderTimingLabel')}
                placeholder={t('billModal.reminderTimingPlaceholder')}
                data={reminderDayOptions}
                value={form.values.reminder_days}
                onChange={(value) => form.setFieldValue('reminder_days', value)}
                clearable={false}
              />
            )}

            <Textarea
              label={t('billModal.notesLabel')}
              placeholder={t('billModal.notesPlaceholder')}
              autosize
              minRows={2}
              maxRows={5}
              {...form.getInputProps('notes')}
            />

            {/* Share button for existing bills */}
            {bill && !bill.archived && (
              <>
                <Divider label={t('billModal.sharingLabel')} labelPosition="center" />
                <Group justify="center">
                  <Button
                    variant="light"
                    color="blue"
                    leftSection={<IconShare size={16} />}
                    onClick={() => setShareModalOpen(true)}
                  >
                    {billShares.length > 0 || (bill.share_count && bill.share_count > 0) ? t('billModal.editSharing') : t('billModal.shareBill')}
                  </Button>
                </Group>

                {/* Display recipient payment status */}
                {billShares.length > 0 && (
                  <Paper p="md" withBorder>
                    <Stack gap="xs">
                      <Text size="sm" fw={500}>
                        {t('billModal.sharedWithCount', { count: billShares.length })}
                      </Text>
                      {billShares.map((share) => (
                        <Box key={share.id}>
                          <Group justify="space-between">
                            <Text size="sm">{share.shared_with}</Text>
                            {share.recipient_paid_date ? (
                              <Badge size="sm" color="green" variant="filled">
                                {t('billModal.paidOn', {
                                  date: new Date(share.recipient_paid_date).toLocaleDateString(getLocale(), {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })
                                })}
                              </Badge>
                            ) : (
                              <Badge size="sm" color="gray" variant="light">
                                {t('billModal.notPaid')}
                              </Badge>
                            )}
                          </Group>
                        </Box>
                      ))}
                    </Stack>
                  </Paper>
                )}
              </>
            )}

            {/* Archive/Delete actions for existing bills */}
            {bill && (onArchive || onUnarchive || onDelete) && (
              <>
                <Divider label={t('billModal.dangerZoneLabel')} labelPosition="center" color="red" />
                <Group justify="center" gap="md">
                  {bill.archived && onUnarchive && (
                    <Button
                      variant="light"
                      color="green"
                      leftSection={<IconArchiveOff size={16} />}
                      onClick={async () => {
                        if (window.confirm(t('billModal.unarchiveConfirm'))) {
                          setLoading(true);
                          try {
                            await onUnarchive(bill);
                            onClose();
                          } finally {
                            setLoading(false);
                          }
                        }
                      }}
                      disabled={loading}
                    >
                      {t('billModal.unarchive')}
                    </Button>
                  )}
                  {!bill.archived && onArchive && (
                    <Button
                      variant="light"
                      color="orange"
                      leftSection={<IconArchive size={16} />}
                      onClick={async () => {
                        if (window.confirm(t('billModal.archiveConfirm'))) {
                          setLoading(true);
                          try {
                            await onArchive(bill);
                            onClose();
                          } finally {
                            setLoading(false);
                          }
                        }
                      }}
                      disabled={loading}
                    >
                      {t('billModal.archive')}
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={async () => {
                        if (window.confirm(t('billModal.deleteConfirm'))) {
                          setLoading(true);
                          try {
                            await onDelete(bill);
                            onClose();
                          } finally {
                            setLoading(false);
                          }
                        }
                      }}
                      disabled={loading}
                    >
                      {t('billModal.deletePermanently')}
                    </Button>
                  )}
                </Group>
              </>
            )}

            {/* Actions */}
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={onClose}>
                {t('common.actions.cancel')}
              </Button>
              <Button type="submit" loading={loading}>
                {bill ? t('billModal.updateBill') : t('billModal.addBill')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <IconPicker
        opened={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        onSelect={(icon) => form.setFieldValue('icon', icon)}
        currentIcon={form.values.icon}
      />

      <ShareBillModal
        opened={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        bill={bill}
      />
    </>
  );
}
