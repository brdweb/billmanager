import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSubscriptionStatus: vi.fn(), getBillingUsage: vi.fn(), createCheckoutSession: vi.fn(),
  selfHosted: false, isAdmin: true,
}));
vi.mock('../api/client', () => mocks);
vi.mock('../context/ConfigContext', () => ({ useConfig: () => ({ isSelfHosted: mocks.selfHosted }) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAdmin: mocks.isAdmin }) }));
import { Billing } from '../pages/Billing';

beforeEach(() => {
  mocks.selfHosted = false;
  mocks.isAdmin = true;
  mocks.getSubscriptionStatus.mockResolvedValue({ has_subscription: false, effective_tier: 'free' });
  mocks.getBillingUsage.mockResolvedValue(null);
  mocks.createCheckoutSession.mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
});
function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}
function show(path = '/billing', checkoutResult?: 'success' | 'cancel') {
  render(<MantineProvider><MemoryRouter initialEntries={[path]}>
    <Billing checkoutResult={checkoutResult} /><Search />
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
    'New accounts start with a 30-day free trial; no payment method required. Subscribing during the trial ends it '
    + 'and starts paid billing right away.'
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
  expect(screen.getByTestId('search')).toHaveTextContent(/^$/);
  const calls = mocks.getSubscriptionStatus.mock.calls.length;
  await flush(120_000);
  expect(mocks.getSubscriptionStatus).toHaveBeenCalledTimes(calls);
});
it('drops session_id when Pro is already active on return so a reload does not replay activation', async () => {
  mocks.getSubscriptionStatus.mockResolvedValue(paidPro);
  show('/billing/success?session_id=cs_test_1&utm=x', 'success');
  await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('?utm=x'));
  expect(screen.getByText('Pro is now active. Thanks for subscribing!')).toBeInTheDocument();
});
it('does not show the trial-expired purchase prompt while a checkout activates or after timeout', async () => {
  vi.useFakeTimers();
  mocks.getSubscriptionStatus.mockResolvedValue({ has_subscription: true, is_trialing: true,
    is_trial_expired: true, status: 'trialing', effective_tier: 'free' });
  show('/billing/success?session_id=cs_test_1', 'success');
  await flush();
  expect(screen.getByText(PENDING)).toBeInTheDocument();
  expect(screen.queryByText(/Your trial has expired/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Get Pro' })).not.toBeInTheDocument();
  await flush(60_000);
  expect(screen.getByText(TIMEOUT)).toBeInTheDocument();
  expect(screen.queryByText(/Your trial has expired/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Get Pro' })).not.toBeInTheDocument();
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
it('treats the pending row left by a canceled first checkout as Free so the user can retry', async () => {
  mocks.getSubscriptionStatus.mockResolvedValue({ has_subscription: true, is_trialing: false, status: 'pending',
    tier: 'pro', effective_tier: 'free', billing_interval: 'monthly' });
  show('/billing/cancel', 'cancel');
  expect(await screen.findByRole('button', { name: 'Get Pro' })).toBeInTheDocument();
  expect(screen.getAllByText('Free')).toHaveLength(2); // plan badge and current tier
  expect(screen.queryByText('pending')).not.toBeInTheDocument();
  expect(screen.queryByText('Billing')).not.toBeInTheDocument();
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

it('offers purchase only to the account owner, who alone can cancel in the billing portal', async () => {
  mocks.isAdmin = false;
  show();
  expect(await screen.findByTestId('pro-owner-only')).toHaveTextContent('Only the account owner can subscribe to Pro and manage billing for this account.');
  expect(screen.queryByRole('button', { name: 'Get Pro' })).toBeNull();
  expect(screen.queryByTestId('pro-renewal-disclosure')).toBeNull();
  expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
});
