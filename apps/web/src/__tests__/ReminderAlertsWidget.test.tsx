import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getReminderAlerts } = vi.hoisted(() => ({ getReminderAlerts: vi.fn() }));

vi.mock('../api/client', () => ({ getReminderAlerts }));

import { ReminderAlertsWidget } from '../components/ReminderAlertsWidget';

function renderWidget() {
  return render(
    <MantineProvider>
      <ReminderAlertsWidget bills={[]} hasDatabase onPayBill={vi.fn()} />
    </MantineProvider>
  );
}

describe('ReminderAlertsWidget', () => {
  beforeEach(() => {
    getReminderAlerts.mockResolvedValue([
      {
        type: 'upcoming',
        bill_id: 1,
        due_date: '2026-07-15',
        severity: 'warning',
        title: 'Utilities bill',
        database_name: 'Household',
        message: 'Due soon',
        amount: 125,
      },
    ]);
  });

  it('hides the floating trigger while the drawer is open and restores it when closed', async () => {
    const user = userEvent.setup();
    renderWidget();

    const trigger = await screen.findByRole('button', { name: 'Open reminder alerts' });
    await user.click(trigger);

    await screen.findByText('Utilities bill');
    expect(screen.queryByRole('button', { name: 'Open reminder alerts' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close reminder alerts' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open reminder alerts' })).toBeInTheDocument();
    });
  });
});
