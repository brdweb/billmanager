import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bill } from '../api/client';

const { mockShareBill, mockGetBillShares } = vi.hoisted(() => ({
  mockShareBill: vi.fn(),
  mockGetBillShares: vi.fn(),
}));

vi.mock('../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/client')>();
  return {
    ...original,
    getBillShares: mockGetBillShares,
    shareBill: mockShareBill,
  };
});

vi.mock('../context/ConfigContext', () => ({
  useConfig: () => ({
    config: { deployment_mode: 'saas' },
    loading: false,
  }),
}));

import { ShareBillModal } from '../components/ShareBillModal';

const bill: Bill = {
  id: 42,
  name: 'Utilities',
  amount: 120,
  varies: false,
  frequency: 'monthly',
  frequency_type: 'simple',
  frequency_config: '',
  next_due: '2026-10-01',
  auto_payment: false,
  paid: false,
  archived: false,
  icon: 'receipt',
  type: 'expense',
  account: null,
  created_at: '2026-09-26T00:00:00Z',
  is_shared: false,
};

function renderModal() {
  return render(
    <MantineProvider>
      <ShareBillModal opened onClose={vi.fn()} bill={bill} />
    </MantineProvider>,
  );
}

describe('ShareBillModal analytics', () => {
  const track = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBillShares.mockResolvedValue([]);
    window.umami = { track };
  });

  it('tracks a successful share exactly once without personal or billing data', async () => {
    mockShareBill.mockResolvedValue({ share_id: 7, status: 'pending', message: 'Shared' });
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/email/i), 'friend@example.com');
    await user.click(screen.getByRole('button', { name: /share bill/i }));

    await waitFor(() => expect(mockShareBill).toHaveBeenCalledOnce());
    expect(track).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith('bill_shared', {
      source: 'bill',
      split_mode: 'full_amount',
    });
  });

  it('does not track a failed share', async () => {
    mockShareBill.mockRejectedValue(new Error('Share failed'));
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/email/i), 'friend@example.com');
    await user.click(screen.getByRole('button', { name: /share bill/i }));

    await waitFor(() => expect(mockShareBill).toHaveBeenCalledOnce());
    expect(track).not.toHaveBeenCalled();
  });

  it('keeps a successful share successful when analytics throws', async () => {
    mockShareBill.mockResolvedValue({ share_id: 7, status: 'pending', message: 'Shared' });
    track.mockImplementation(() => {
      throw new Error('Analytics unavailable');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/email/i), 'placeholder@example.com');
    await user.click(screen.getByRole('button', { name: /share bill/i }));

    expect(await screen.findByText('Shared')).toBeInTheDocument();
    expect(track).toHaveBeenCalledOnce();
    expect(mockGetBillShares).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(/email/i)).toHaveValue('');
    consoleError.mockRestore();
  });
});
