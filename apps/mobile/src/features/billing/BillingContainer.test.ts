import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BillingContainer from './BillingContainer';
import type { BillingActions, BillingViewModel } from './models';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ profile: 'one', principal: 1, actions: null as BillingActions | null,
  status: {} as { can_manage_subscription?: boolean }, owner: true, platform: 'ios', model: null as BillingViewModel | null, request: vi.fn(), openUrl: vi.fn(), alert: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { get OS() { return mocks.platform; } }, Alert: { alert: mocks.alert } }));
vi.mock('expo-linking', () => ({ openURL: mocks.openUrl }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { status: mocks.status, usage: {} }, refetch: vi.fn() }) }));
vi.mock('../../api/client', () => ({ api: {
  captureAuthSessionScope: () => ({ serverProfileId: mocks.profile, principalId: String(mocks.principal), databaseId: 'home' }),
  isPrincipalScopeAuthenticated: async () => true, createCheckoutSession: mocks.request, createPortalSession: mocks.request,
} }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.principal, is_account_owner: mocks.owner } }) }));
vi.mock('../../context/MobileRuntimeContext', () => ({ useMobileRuntime: () => ({ online: true }) }));
vi.mock('../../context/ServerProfileContext', () => ({ useServerProfiles: () => ({ activeProfile: { id: mocks.profile, deploymentMode: 'saas', capabilities: { billing: true } } }) }));
vi.mock('../../i18n/format', () => ({ getFormattingConfig: () => ({ locale: 'en-US', currency: 'USD' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./BillingScreen', () => ({ default: ({ actions, model }: { actions: BillingActions; model: BillingViewModel }) => { mocks.actions = actions; mocks.model = model; return null; } }));
let root: ReactTestRenderer;
beforeEach(async () => {
  vi.clearAllMocks(); mocks.profile = 'one'; mocks.principal = 1; mocks.status = {}; mocks.owner = true; mocks.platform = 'ios';
  await act(async () => { root = create(React.createElement(BillingContainer)); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });

it.each(['profile', 'principal', 'unmount', 'roundtrip'] as const)('does not open late checkout after %s changes while old credentials remain valid', async (change) => {
  let finish!: (response: unknown) => void;
  mocks.request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { mocks.actions!.onSelectPlan('pro-month'); });
  expect(mocks.request).toHaveBeenCalledOnce();
  await act(async () => {
    if (change === 'unmount') root.unmount();
    else { if (change === 'profile' || change === 'roundtrip') mocks.profile = 'two'; else mocks.principal = 2; root.update(React.createElement(BillingContainer)); }
  });
  if (change === 'roundtrip') await act(async () => { mocks.profile = 'one'; root.update(React.createElement(BillingContainer)); });
  await act(async () => { finish({ success: true, data: { url: 'https://checkout.stripe.com/old' } }); });
  expect(mocks.openUrl).not.toHaveBeenCalled();
  expect(mocks.alert).not.toHaveBeenCalled();
});


it.each([false, undefined])('blocks retained portal callbacks without provider availability (%s)', async (available) => {
  mocks.status = { can_manage_subscription: available };
  await act(async () => { root.update(React.createElement(BillingContainer)); });
  expect(mocks.model!.canOpenPortal).toBe(false);
  await act(async () => { mocks.actions!.onOpenPortal(); });
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.model!.canManageBilling).toBe(true); // Eligible free/local accounts can still choose a plan.
  mocks.request.mockResolvedValue({ success: true, data: { url: 'https://checkout.stripe.com/unit' } });
  await act(async () => { mocks.actions!.onSelectPlan('pro-month'); });
  expect(mocks.request).toHaveBeenCalledOnce();
});
it.each(['owner', 'member', 'android'] as const)('preserves provider portal role/platform gates for %s', async (kind) => {
  mocks.status = { can_manage_subscription: true };
  mocks.owner = kind !== 'member'; mocks.platform = kind === 'android' ? 'android' : 'ios';
  mocks.request.mockResolvedValue({ success: true, data: { url: 'https://billing.stripe.com/unit' } });
  await act(async () => { root.update(React.createElement(BillingContainer)); });
  await act(async () => { mocks.actions!.onOpenPortal(); });
  expect(mocks.request).toHaveBeenCalledTimes(kind === 'owner' ? 1 : 0);
  expect(mocks.openUrl).toHaveBeenCalledTimes(kind === 'owner' ? 1 : 0);
});

it('expires a retained portal callback when availability is revoked on the same account', async () => {
  mocks.status = { can_manage_subscription: true };
  await act(async () => { root.update(React.createElement(BillingContainer)); });
  const retained = mocks.actions!.onOpenPortal;
  mocks.status = { can_manage_subscription: false };
  await act(async () => { root.update(React.createElement(BillingContainer)); });
  await act(async () => { retained(); });
  expect(mocks.request).not.toHaveBeenCalled();
});
it('does not open a pending portal URL after provider management is revoked', async () => {
  mocks.status = { can_manage_subscription: true };
  await act(async () => { root.update(React.createElement(BillingContainer)); });
  let finish!: (response: unknown) => void;
  mocks.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { mocks.actions!.onOpenPortal(); });
  expect(mocks.request).toHaveBeenCalledOnce();
  mocks.status = { can_manage_subscription: false };
  await act(async () => { root.update(React.createElement(BillingContainer)); });
  await act(async () => { finish({ success: true, data: { url: 'https://billing.stripe.com/unit' } }); });
  expect(mocks.openUrl).not.toHaveBeenCalled();
});
