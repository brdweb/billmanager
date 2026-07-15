import type { BillFrequency, BillFrequencyType } from '../../types';

export interface BillFrequencyOption {
  labelKey: string;
  value: BillFrequency;
}

export const BILL_FREQUENCY_OPTIONS: readonly BillFrequencyOption[] = [
  { labelKey: 'common.frequency.once', value: 'once' },
  { labelKey: 'common.frequency.weekly', value: 'weekly' },
  { labelKey: 'common.frequency.biweekly', value: 'bi-weekly' },
  { labelKey: 'common.frequency.monthly', value: 'monthly' },
  { labelKey: 'common.frequency.quarterly', value: 'quarterly' },
  { labelKey: 'common.frequency.yearly', value: 'yearly' },
  { labelKey: 'common.frequency.custom', value: 'custom' },
];

export function frequencyTypeForSelection(frequency: BillFrequency): BillFrequencyType {
  return frequency === 'custom' ? 'multiple_weekly' : 'simple';
}

export function billFrequencyFields(
  frequency: BillFrequency,
  frequencyType: BillFrequencyType,
  specificDates: number[],
  weeklyDays: number[],
): Pick<
  { frequency_type: BillFrequencyType; frequency_config: string },
  'frequency_type' | 'frequency_config'
> {
  if (frequency === 'monthly' && frequencyType === 'specific_dates') {
    return {
      frequency_type: 'specific_dates',
      frequency_config: JSON.stringify({ dates: specificDates }),
    };
  }

  if (frequency === 'custom') {
    return {
      frequency_type: 'multiple_weekly',
      frequency_config: JSON.stringify({ days: [...weeklyDays].sort((left, right) => left - right) }),
    };
  }

  return {
    frequency_type: 'simple',
    frequency_config: JSON.stringify({}),
  };
}
