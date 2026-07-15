import { describe, expect, it } from 'vitest';

import type { Bill } from '../types';
import { optimisticBillAfterPayment } from './optimisticPayment';

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 1,
    name: 'One-off purchase',
    amount: 42,
    varies: false,
    frequency: 'once',
    frequency_type: 'simple',
    frequency_config: '{}',
    next_due: '2026-07-15',
    auto_payment: false,
    reminder_enabled: true,
    reminder_days: [1],
    icon: 'payment',
    type: 'expense',
    account: null,
    category: null,
    notes: null,
    archived: false,
    is_shared: false,
    ...overrides,
  };
}

describe('optimistic payment bill lifecycle', () => {
  it('archives a one-time bill without changing its due date', () => {
    const updated = optimisticBillAfterPayment(bill(), true);

    expect(updated).toMatchObject({ archived: true, next_due: '2026-07-15' });
  });

  it('archives a one-time bill even when due-date advancement is disabled', () => {
    const updated = optimisticBillAfterPayment(bill(), false);

    expect(updated).toMatchObject({ archived: true, next_due: '2026-07-15' });
  });

  it('continues to advance recurring bills when requested', () => {
    const updated = optimisticBillAfterPayment(bill({ frequency: 'monthly' }), true);

    expect(updated).toMatchObject({ archived: false, next_due: '2026-08-15' });
  });
});
