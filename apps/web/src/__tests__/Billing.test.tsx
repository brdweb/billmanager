import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSubscriptionStatus: vi.fn(), getBillingUsage: vi.fn(), createCheckoutSession: vi.fn(),
  selfHosted: false,
}));
vi.mock('../api/client', () => mocks);
vi.mock('../context/ConfigContext', () => ({ useConfig: () => ({ isSelfHosted: mocks.selfHosted }) }));
import { Billing } from '../pages/Billing';

beforeEach(() => {
  mocks.selfHosted = false;
  mocks.getSubscriptionStatus.mockResolvedValue({ has_subscription: false, effective_tier: 'free' });
  mocks.getBillingUsage.mockResolvedValue(null);
  mocks.createCheckoutSession.mockResolvedValue({});
});
function show() {
  render(<MantineProvider><MemoryRouter><Billing /></MemoryRouter></MantineProvider>);
}
it('offers only Pro at $2.99 monthly or $24 annually and sends the selected interval', async () => {
  const user = userEvent.setup();
  show();
  await screen.findByRole('button', { name: 'Get Pro' });
  expect(screen.getByText('$2.99')).toBeInTheDocument();
  expect(screen.getByText('Up to 6 family members')).toBeInTheDocument();
  expect(screen.queryByText('Basic')).not.toBeInTheDocument();
  expect(screen.queryByText('Plus')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Get Pro' }));
  expect(mocks.createCheckoutSession).toHaveBeenLastCalledWith('pro', 'monthly');
  await user.click(screen.getByRole('radio', { name: 'Annual (Save 33%)' }));
  expect(screen.getByText('$24.00')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Get Pro' }));
  expect(mocks.createCheckoutSession).toHaveBeenLastCalledWith('pro', 'annual');
  expect(screen.getByText('30-day free trial included. Cancel anytime.')).toBeInTheDocument();
});
it('lets a trial subscriber convert to Pro', async () => {
  mocks.getSubscriptionStatus.mockResolvedValue({ has_subscription: true, is_trialing: true,
    status: 'trialing', effective_tier: 'pro', trial_days_remaining: 29 });
  show();
  expect(await screen.findByRole('button', { name: 'Get Pro' })).toBeInTheDocument();
});
it('keeps self-hosted billing unlimited with no purchase action', async () => {
  mocks.selfHosted = true;
  show();
  expect(screen.queryByRole('button', { name: 'Get Pro' })).not.toBeInTheDocument();
  expect(screen.getByText('Unlimited family members and users')).toBeInTheDocument();
});
