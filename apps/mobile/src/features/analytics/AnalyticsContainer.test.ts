import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-navigation/native', () => ({}));
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/MobileRuntimeContext', () => ({ useMobileRuntime: vi.fn() }));
vi.mock('../../i18n/format', () => ({ formatDate: vi.fn(), getFormattingConfig: vi.fn() }));
vi.mock('./AnalyticsScreen', () => ({ default: vi.fn() }));

import type { Bill } from '../../types';
import { projectRecurringBills } from './AnalyticsContainer';

function recurringBill(overrides: Partial<Bill>): Bill {
  return {
    id: 1,
    name: 'Rent',
    amount: 1000,
    varies: false,
    frequency: 'monthly',
    frequency_type: 'simple',
    frequency_config: '{}',
    next_due: '2026-08-15',
    auto_payment: false,
    icon: 'home',
    type: 'expense',
    account: null,
    category: null,
    notes: null,
    archived: false,
    is_shared: false,
    ...overrides,
  };
}

describe('recurrence-aware analytics forecast', () => {
  it('projects expenses and deposits into each future month in range', () => {
    const projected = projectRecurringBills(
      [
        recurringBill({ id: 1, amount: 1000, type: 'expense' }),
        recurringBill({ id: 2, amount: 2500, type: 'deposit', next_due: '2026-08-30' }),
      ],
      new Date(2026, 7, 1),
      new Date(2026, 9, 31, 23, 59),
    );

    expect(projected.get('2026-08')).toEqual({ income: 2500, expenses: 1000 });
    expect(projected.get('2026-09')).toEqual({ income: 2500, expenses: 1000 });
    expect(projected.get('2026-10')).toEqual({ income: 2500, expenses: 1000 });
  });

  it('ignores archived bills', () => {
    const projected = projectRecurringBills(
      [recurringBill({ archived: true })],
      new Date(2026, 7, 1),
      new Date(2026, 8, 30),
    );
    expect(projected.size).toBe(0);
  });

  it('projects a one-time bill only in its due month', () => {
    const projected = projectRecurringBills(
      [recurringBill({ frequency: 'once', amount: 400 })],
      new Date(2026, 7, 1),
      new Date(2026, 9, 31, 23, 59),
    );

    expect(projected.get('2026-08')).toEqual({ income: 0, expenses: 400 });
    expect(projected.has('2026-09')).toBe(false);
    expect(projected.has('2026-10')).toBe(false);
  });
});
