import { useEffect, useState } from 'react';
import {
  Modal,
  TextInput,
  NumberInput,
  Select,
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
} from '@mantine/core';
import { IconArchive, IconArchiveOff, IconTrash } from '@tabler/icons-react';
import { DatePickerInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import type { Bill } from '../api/client';
import * as api from '../api/client';
import { IconPicker } from './IconPicker';
import { BillIcon } from './BillIcon';
import { formatDateForAPI } from '../utils/date';

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
  icon: string;
  type: 'expense' | 'deposit';
  account: string | null;
}

interface BillModalProps {
  opened: boolean;
  onClose: () => void;
  onSave: (bill: Partial<Bill>) => Promise<void>;
  onArchive?: (bill: Bill) => Promise<void>;
  onUnarchive?: (bill: Bill) => Promise<void>;
  onDelete?: (bill: Bill) => Promise<void>;
  bill: Bill | null;
}

const frequencyOptions = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom (multiple days/week)' },
];

const dayOptions = [
  { label: 'Mon', value: 0 },
  { label: 'Tue', value: 1 },
  { label: 'Wed', value: 2 },
  { label: 'Thu', value: 3 },
  { label: 'Fri', value: 4 },
  { label: 'Sat', value: 5 },
  { label: 'Sun', value: 6 },
];

export function BillModal({ opened, onClose, onSave, onArchive, onUnarchive, onDelete, bill }: BillModalProps) {
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);

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
      icon: 'payment',
      type: 'expense',
      account: null,
    },
    validate: {
      name: (value) => (!value.trim() ? 'Name is required' : null),
      next_due: (value, values) => {
        if (values.frequency === 'monthly' && values.frequency_type === 'specific_dates') {
          return null; // Not required for specific dates
        }
        return !value ? 'Due date is required' : null;
      },
      monthly_dates: (value, values) => {
        if (values.frequency === 'monthly' && values.frequency_type === 'specific_dates') {
          if (!value.trim()) return 'Enter at least one date';
          const dates = value.split(',').map((d) => parseInt(d.trim()));
          if (dates.some((d) => isNaN(d) || d < 1 || d > 31)) {
            return 'Invalid date(s). Use numbers 1-31';
          }
        }
        return null;
      },
      weekly_days: (value, values) => {
        if (values.frequency === 'custom' && values.frequency_type === 'multiple_weekly') {
          if (value.length === 0) return 'Select at least one day';
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
    }
  }, [opened]);

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
            next_due: bill.next_due ? new Date(bill.next_due) : null,
            auto_payment: bill.auto_payment || false,
            icon: bill.icon || 'payment',
            type: bill.type || 'expense',
            account: bill.account || null,
          });
        } else {
          form.reset();
        }
      } catch {
        // Form initialization error - silent fail, form will be in default state
      }
    }
  }, [bill, opened]);

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
        icon: values.icon,
        type: values.type,
        account: values.account || null,
      };

      await onSave(billData);
      window.umami?.track(bill ? 'bill_updated' : 'bill_created', { type: values.type });
      onClose();
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
        title={bill ? 'Edit Bill' : 'Add Bill'}
        size="lg"
        centered
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            {/* Row 1: Name and Icon */}
            <Group grow align="flex-start">
              <TextInput
                label="Bill Name"
                placeholder="Enter bill name"
                required
                {...form.getInputProps('name')}
              />
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Icon
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
                label="Type"
                data={[
                  { value: 'expense', label: 'Expense (Bill)' },
                  { value: 'deposit', label: 'Deposit (Income)' }
                ]}
                {...form.getInputProps('type')}
              />
              <Autocomplete
                label="Account"
                placeholder="Type account name"
                data={accounts}
                value={form.values.account || ''}
                onChange={(value) => form.setFieldValue('account', value || null)}
                limit={5}
              />
            </Group>

            {/* Row 3: Amount and Varies */}
            <Group grow align="flex-end">
              <NumberInput
                label="Amount"
                placeholder="0.00"
                prefix="$"
                decimalScale={2}
                fixedDecimalScale
                disabled={form.values.varies}
                {...form.getInputProps('amount')}
              />
              <Switch
                label="Amount varies"
                checked={form.values.varies}
                onChange={(event) =>
                  form.setFieldValue('varies', event.currentTarget.checked)
                }
              />
            </Group>

            {/* Row 3: Frequency */}
            <Select
              label="Frequency"
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
                    Monthly Schedule
                  </Text>
                  <Group>
                    <Switch
                      label="Use specific dates (e.g., 1st & 15th)"
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
                      label="Dates (comma-separated)"
                      placeholder="1, 15"
                      description="Enter days of the month (1-31)"
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
                    Days of Week
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
                label="Next Due Date"
                placeholder="Select date"
                required
                valueFormat="MMMM D, YYYY"
                {...form.getInputProps('next_due')}
              />
            )}

            {/* Auto Payment */}
            <Switch
              label="Auto Payment"
              description="Automatically process this bill when due"
              checked={form.values.auto_payment}
              onChange={(event) =>
                form.setFieldValue('auto_payment', event.currentTarget.checked)
              }
            />

            {/* Archive/Delete actions for existing bills */}
            {bill && (onArchive || onUnarchive || onDelete) && (
              <>
                <Divider label="Danger Zone" labelPosition="center" color="red" />
                <Group justify="center" gap="md">
                  {bill.archived && onUnarchive && (
                    <Button
                      variant="light"
                      color="green"
                      leftSection={<IconArchiveOff size={16} />}
                      onClick={async () => {
                        if (window.confirm('Unarchive this bill? It will be restored to your active bills list.')) {
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
                      Unarchive
                    </Button>
                  )}
                  {!bill.archived && onArchive && (
                    <Button
                      variant="light"
                      color="orange"
                      leftSection={<IconArchive size={16} />}
                      onClick={async () => {
                        if (window.confirm('Archive this bill? It will be hidden from the main list but payment history will be preserved.')) {
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
                      Archive
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={async () => {
                        if (window.confirm('PERMANENTLY DELETE this bill and ALL payment history? This cannot be undone!')) {
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
                      Delete Permanently
                    </Button>
                  )}
                </Group>
              </>
            )}

            {/* Actions */}
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={loading}>
                {bill ? 'Update' : 'Add'} Bill
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
    </>
  );
}
