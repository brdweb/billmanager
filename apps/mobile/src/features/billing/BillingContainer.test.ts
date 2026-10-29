import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BillingContainer from './BillingContainer';
import type { BillingActions } from './models';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ profile: 'one', principal: 1, actions: null as BillingActions | null,
  request: vi.fn(), openUrl: vi.fn(), alert: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, Alert: { alert: mocks.alert } }));
vi.mock('expo-linking', () => ({ openURL: mocks.openUrl }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { status: {}, usage: {} }, refetch: vi.fn() }) }));
vi.mock('../../api/client', () => ({ api: {
  captureAuthSessionScope: () => ({ serverProfileId: mocks.profile, principalId: String(mocks.principal), databaseId: 'home' }),
  isPrincipalScopeAuthenticated: async () => true, createCheckoutSession: mocks.request, createPortalSession: mocks.request,
} }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.principal, is_account_owner: true } }) }));
vi.mock('../../context/MobileRuntimeContext', () => ({ useMobileRuntime: () => ({ online: true }) }));
vi.mock('../../context/ServerProfileContext', () => ({ useServerProfiles: () => ({ activeProfile: { id: mocks.profile, deploymentMode: 'saas', capabilities: { billing: true } } }) }));
vi.mock('../../i18n/format', () => ({ getFormattingConfig: () => ({ locale: 'en-US', currency: 'USD' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./BillingScreen', () => ({ default: ({ actions }: { actions: BillingActions }) => { mocks.actions = actions; return null; } }));
let root: ReactTestRenderer;
beforeEach(async () => {
  vi.clearAllMocks(); mocks.profile = 'one'; mocks.principal = 1;
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
