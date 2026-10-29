import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettlementsContainer from './SettlementsContainer';
import type { SettlementsActions } from './models';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReactTestRenderer;
const mocks = vi.hoisted(() => ({
  profile: 'cloud', principal: 'owner', database: 'home',
  alert: vi.fn(), markPaid: vi.fn(), current: vi.fn(), refetch: vi.fn(),
  actions: null as SettlementsActions | null,
  data: { summary: { owed_to_me: 0, i_owe: 30, net_balance: -30 }, people: [], settled: [], owed_to_me: [],
    i_owe: [1, 2].map((id) => ({ share_id: id, counterparty_name: 'Alex', bill_name: `Bill ${id}`, due_date: '2026-10-29', amount: 15 })) },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.data, refetch: mocks.refetch }) }));
vi.mock('../../api/client', () => ({ api: {
  captureAuthSessionScope: () => ({ serverProfileId: mocks.profile, principalId: mocks.principal, databaseId: mocks.database }),
  isPrincipalScopeAuthenticated: mocks.current, markSharePaid: mocks.markPaid,
} }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.principal }, currentDatabase: mocks.database, databases: [] }) }));
vi.mock('../../context/MobileRuntimeContext', () => ({ useMobileRuntime: () => ({ online: true }) }));
vi.mock('../../context/ServerProfileContext', () => ({ useServerProfiles: () => ({ activeProfile: { id: mocks.profile, capabilities: { settlements: true } } }) }));
vi.mock('../../data/cacheRepository', () => ({ MobileCacheRepository: class {} }));
vi.mock('../../i18n/format', () => ({ getFormattingConfig: () => ({ locale: 'en-US', currency: 'USD' }), formatDate: (v: string) => v }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./SettlementsScreen', () => ({ default: ({ actions }: { actions: SettlementsActions }) => { mocks.actions = actions; return null; } }));

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.profile = 'cloud'; mocks.principal = 'owner'; mocks.database = 'home';
  mocks.current.mockResolvedValue(true);
  mocks.refetch.mockResolvedValue({});
  mocks.markPaid.mockImplementation(async (id: number) => ({ success: id !== 2 }));
  await act(async () => { root = create(React.createElement(SettlementsContainer)); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });
function confirmLatest() {
  const buttons = mocks.alert.mock.calls.at(-1)?.[2] as { onPress: () => void }[];
  buttons[1].onPress();
}
it('shows partial failure details and never resubmits confirmed shares from stale data', async () => {
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); mocks.actions!.onMarkPaid('Alex'); });
  expect(mocks.alert).toHaveBeenCalledOnce();
  await act(async () => { confirmLatest(); await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce()); });
  expect(mocks.alert.mock.calls[1][0]).toBe('settlementsPage.markPaidFailedTitle');
  expect(mocks.alert.mock.calls[1][1]).toContain('1/2');
  expect(mocks.alert.mock.calls[1][1]).toContain('Bill 2');
  const retryMutationId = mocks.markPaid.mock.calls.find(([id]) => id === 2)![2];
  mocks.markPaid.mockClear().mockResolvedValue({ success: true });
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); confirmLatest(); await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2)); });
  expect(mocks.markPaid.mock.calls.map(([id]) => id)).toEqual([2]);
  expect(mocks.markPaid.mock.calls[0][2]).toBe(retryMutationId);
});
it('rejects an old-account confirmation after the dialog opens', async () => {
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); });
  mocks.current.mockResolvedValue(false);
  await act(async () => { confirmLatest(); });
  expect(mocks.markPaid).not.toHaveBeenCalled();
});

it.each(['profile', 'principal', 'database'] as const)('rejects old confirmation after %s switch with valid stored credentials', async (field) => {
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); });
  const confirm = mocks.alert.mock.calls[0][2][1].onPress;
  mocks[field] = 'another';
  await act(async () => { root.update(React.createElement(SettlementsContainer)); });
  await act(async () => { confirm(); });
  expect(mocks.markPaid).not.toHaveBeenCalled();
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); });
  expect(mocks.alert).toHaveBeenCalledTimes(2);
});
it('rejects confirmation after unmount', async () => {
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); });
  const confirm = mocks.alert.mock.calls[0][2][1].onPress;
  await act(async () => { root.unmount(); });
  await act(async () => { confirm(); });
  expect(mocks.markPaid).not.toHaveBeenCalled();
});
it('consumes duplicate native confirmation events only once', async () => {
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); });
  const confirm = mocks.alert.mock.calls[0][2][1].onPress;
  await act(async () => { confirm(); confirm(); await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce()); });
  expect(mocks.markPaid).toHaveBeenCalledTimes(2);
});
it('stops the remaining batch and UI effects after a profile switches during a payment', async () => {
  let finish!: (value: { success: boolean }) => void;
  mocks.markPaid.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); confirmLatest(); });
  expect(mocks.markPaid).toHaveBeenCalledOnce();
  mocks.profile = 'another';
  await act(async () => { root.update(React.createElement(SettlementsContainer)); });
  await act(async () => { finish({ success: true }); });
  expect(mocks.markPaid).toHaveBeenCalledOnce();
  expect(mocks.refetch).not.toHaveBeenCalled();
  expect(mocks.alert).toHaveBeenCalledOnce();
});
