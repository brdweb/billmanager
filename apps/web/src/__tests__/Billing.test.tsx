import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
afterEach(() => {
  vi.useRealTimers();
});
function show(path = '/billing', checkoutResult?: 'success' | 'cancel') {
  render(<MantineProvider><MemoryRouter initialEntries={[path]}>
    <Billing checkoutResult={checkoutResult} />
  </MemoryRouter></MantineProvider>);
}
const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const trialPro = { has_subscription: true, is_trialing: true, status: 'trialing', effective_tier: 'pro' };
const paidPro = { has_subscription: true, is_trialing: false, status: 'active', effective_tier: 'pro' };
const PENDING = "Thanks for subscribing! Your payment was received and we're activating Pro…";
const TIMEOUT = "Payment received. Activation can take a minute, so refresh the status shortly. You don't need to check out again.";
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
  expect(screen.getByText(
    'New accounts start with a 30-day free trial; no payment method required. Subscribing starts paid billing right away.'
  )).toBeInTheDocument();
});
it('discloses price, automatic renewal, cancellation and legal links next to Get Pro', async () => {
  const user = userEvent.setup();
  show();
  await screen.findByRole('button', { name: 'Get Pro' });
  const disclosure = screen.getByTestId('pro-renewal-disclosure');
  expect(disclosure).toHaveTextContent('$2.99 per month, charged when you subscribe. Your subscription renews '
    + 'automatically every month until you cancel. Cancel anytime with Manage Subscription in the billing portal.');
  expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', 'https://billmanager.app/terms');
  expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', 'https://billmanager.app/privacy');
  await user.click(screen.getByRole('radio', { name: 'Annual (Save 33%)' }));
  expect(disclosure).toHaveTextContent('$24.00 per year, charged when you subscribe. Your subscription renews '
    + 'automatically every year until you cancel.');
});
it('confirms a returned checkout and polls until the paid subscription is active, not merely trialing', async () => {
  vi.useFakeTimers();
  mocks.getSubscriptionStatus.mockResolvedValueOnce(trialPro).mockResolvedValueOnce(trialPro)
    .mockResolvedValueOnce(trialPro).mockResolvedValue(paidPro);
  show('/billing/success?session_id=cs_test_1', 'success');
  await flush();
  expect(screen.getByText(PENDING)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Get Pro' })).not.toBeInTheDocument();
  await flush(3000);
  expect(screen.getByText(PENDING)).toBeInTheDocument();
  await flush(3000);
  expect(screen.getByText('Pro is now active. Thanks for subscribing!')).toBeInTheDocument();
  expect(screen.getByText('Active')).toBeInTheDocument();
  const calls = mocks.getSubscriptionStatus.mock.calls.length;
  await flush(120_000);
  expect(mocks.getSubscriptionStatus).toHaveBeenCalledTimes(calls);
});
it('stops polling after about a minute without offering a second purchase', async () => {
  vi.useFakeTimers();
  mocks.getSubscriptionStatus.mockResolvedValue({ ...trialPro, trial_days_remaining: 2 });
  show('/billing/success?session_id=cs_test_1', 'success');
  await flush();
  await flush(59_000);
  expect(screen.queryByText(TIMEOUT)).not.toBeInTheDocument();
  await flush(1_000);
  expect(screen.getByText(TIMEOUT)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Get Pro' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Subscribe now/)).not.toBeInTheDocument();
  expect(mocks.getSubscriptionStatus).toHaveBeenCalledTimes(9);
  await flush(120_000);
  expect(mocks.getSubscriptionStatus).toHaveBeenCalledTimes(9);
  mocks.getSubscriptionStatus.mockResolvedValue(paidPro);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await flush(1_000);
  expect(screen.getByText('Pro is now active. Thanks for subscribing!')).toBeInTheDocument();
});
it('shows a neutral note after canceled checkout and keeps the plan offer', async () => {
  show('/billing/cancel', 'cancel');
  expect(await screen.findByText('Checkout canceled. You were not charged and your plan has not changed.'))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Get Pro' })).toBeInTheDocument();
  expect(screen.queryByText(PENDING)).not.toBeInTheDocument();
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


it.each([false, undefined])('does not offer Manage for local Pro without explicit provider availability (%s)', async (availability) => {
  mocks.getSubscriptionStatus.mockResolvedValue({ has_subscription: true, is_active: true,
    status: 'active', effective_tier: 'pro', can_manage_subscription: availability });
  show();
  await screen.findByText('Current Plan');
  expect(screen.queryByRole('button', { name: 'Manage Subscription' })).not.toBeInTheDocument();
});
it('retains Manage for an eligible provider customer', async () => {
  mocks.getSubscriptionStatus.mockResolvedValue({ has_subscription: true, status: 'active',
    effective_tier: 'pro', can_manage_subscription: true });
  show();
  expect(await screen.findByRole('button', { name: 'Manage Subscription' })).toBeInTheDocument();
});
it('treats /billing/success without a checkout session as the normal billing page', async () => {
  show('/billing/success', 'success');
  expect(await screen.findByRole('button', { name: 'Get Pro' })).toBeInTheDocument();
  expect(screen.queryByText(PENDING)).not.toBeInTheDocument();
});
