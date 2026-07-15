import { describe, expect, it } from 'vitest';

import de from '../../i18n/locales/de.json';
import en from '../../i18n/locales/en.json';
import {
  BILL_FREQUENCY_OPTIONS,
  billFrequencyFields,
  frequencyTypeForSelection,
} from './formModels';

describe('bill form frequency options', () => {
  it('offers a localized one-time cadence', () => {
    expect(BILL_FREQUENCY_OPTIONS[0]).toEqual({
      labelKey: 'common.frequency.once',
      value: 'once',
    });
    expect(en.common.frequency.once).toBe('One-time');
    expect(de.common.frequency.once).toBe('Einmalig');
  });

  it('clears stale recurring schedule state for one-time bills', () => {
    expect(frequencyTypeForSelection('once')).toBe('simple');
    expect(billFrequencyFields('once', 'specific_dates', [1, 15], [1, 4])).toEqual({
      frequency_type: 'simple',
      frequency_config: '{}',
    });
    expect(billFrequencyFields('once', 'multiple_weekly', [10], [2, 5])).toEqual({
      frequency_type: 'simple',
      frequency_config: '{}',
    });
  });
});
