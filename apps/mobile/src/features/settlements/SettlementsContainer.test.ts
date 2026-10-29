import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettlementsContainer from './SettlementsContainer';
import type { SettlementLedgerItem, SettlementsResponse } from '../../types';
import type { SettlementsActions, SettlementsViewModel } from './models';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReactTestRenderer;
const mocks = vi.hoisted(() => ({
  profile: 'cloud', principal: 'owner', database: 'home',
  alert: vi.fn(), markPaid: vi.fn(), current: vi.fn(), refetch: vi.fn(), read: vi.fn(),
  queryFn: null as (() => Promise<SettlementsResponse>) | null,
  model: null as SettlementsViewModel | null,
  actions: null as SettlementsActions | null,
  data: { summary: { owed_to_me: 0, i_owe: 30, net_balance: -30 }, people: [], settled: [], owed_to_me: [],
    i_owe: [1, 2].map((id) => ({ share_id: id, counterparty_name: 'Alex', bill_name: `Bill ${id}`, due_date: '2026-10-29', amount: 15 })) } as unknown as SettlementsResponse,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: { queryFn: () => Promise<SettlementsResponse> }) => { mocks.queryFn = options.queryFn; return { data: mocks.data, refetch: mocks.refetch }; } }));
vi.mock('../../api/client', () => ({ api: {
  captureAuthSessionScope: () => ({ serverProfileId: mocks.profile, principalId: mocks.principal, databaseId: mocks.database }),
  isPrincipalScopeAuthenticated: mocks.current, markSharePaid: mocks.markPaid, requestScopedGet: mocks.read,
} }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.principal }, currentDatabase: mocks.database, databases: [] }) }));
vi.mock('../../context/MobileRuntimeContext', () => ({ useMobileRuntime: () => ({ online: true }) }));
vi.mock('../../context/ServerProfileContext', () => ({ useServerProfiles: () => ({ activeProfile: { id: mocks.profile, capabilities: { settlements: true } } }) }));
vi.mock('../../data/cacheRepository', () => ({ MobileCacheRepository: class { async putAnalyticsSnapshot() {} } }));
vi.mock('../../i18n/format', () => ({ getFormattingConfig: () => ({ locale: 'en-US', currency: 'USD' }), formatDate: (v: string) => v }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./SettlementsScreen', () => ({ default: ({ actions, model }: { actions: SettlementsActions; model: SettlementsViewModel }) => { mocks.actions = actions; mocks.model = model; return null; } }));

function serverSnapshot(unpaid: number[], paid: number[] = []): SettlementsResponse {
  const item = (id: number, settled: boolean): SettlementLedgerItem => ({ share_id: id, direction: 'i_owe',
    bill_id: id, counterparty_user_id: 3, counterparty_name: 'Alex', bill_name: `Bill ${id}`,
    due_date: '2026-10-29', amount: 15, paid: settled, paid_date: settled ? '2026-10-29' : null });
  return { summary: { owed_to_me: 0, i_owe: unpaid.length * 15, net_balance: -unpaid.length * 15,
    open_count: unpaid.length, settled_count: paid.length }, people: [], owed_to_me: [],
    i_owe: unpaid.map((id) => item(id, false)), settled: paid.map((id) => item(id, true)) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.profile = 'cloud'; mocks.principal = 'owner'; mocks.database = 'home';
  mocks.data = serverSnapshot([1, 2]);
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

it('allows paying outgoing shares even when the same person owes more in the other direction', async () => {
  mocks.data = serverSnapshot([1]);
  mocks.data.i_owe[0].amount = 10;
  mocks.data.people = [{ counterparty_name: 'Alex', owed_to_me: 20, i_owe: 10, net: 10, open_count: 2 }];
  await act(async () => { root.update(React.createElement(SettlementsContainer)); });
  expect(mocks.model!.people[0]).toMatchObject({ direction: 'owes-you', canMarkPaid: true });
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); confirmLatest();
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce()); });
  expect(mocks.markPaid.mock.calls.map(([id]) => id)).toEqual([1]);
});

it('retires an observed paid occurrence before reopening while preserving the failed occurrence retry UUID', async () => {
  const observedPaid = serverSnapshot([2], [1]);
  mocks.read.mockResolvedValue({ success: true, data: observedPaid });
  mocks.refetch.mockImplementation(async () => ({ data: await mocks.queryFn!(), isSuccess: true }));
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); confirmLatest();
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce()); });
  const firstId = mocks.markPaid.mock.calls.find(([id]) => id === 1)![2];
  const uncertainId = mocks.markPaid.mock.calls.find(([id]) => id === 2)![2];
  mocks.data = serverSnapshot([1, 2]);
  mocks.read.mockResolvedValue({ success: true, data: mocks.data });
  await act(async () => { root.update(React.createElement(SettlementsContainer)); await mocks.queryFn!(); });
  mocks.markPaid.mockClear().mockResolvedValue({ success: true });
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); confirmLatest();
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2)); });
  expect(mocks.markPaid.mock.calls.map(([id]) => id)).toEqual([1, 2]);
  expect(mocks.markPaid.mock.calls.find(([id]) => id === 1)![2]).not.toBe(firstId);
  expect(mocks.markPaid.mock.calls.find(([id]) => id === 2)![2]).toBe(uncertainId);
});

it('does not retire confirmation or retry identity when a pre-mutation read arrives late', async () => {
  let finish!: (value: { success: boolean; data: SettlementsResponse }) => void;
  mocks.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const oldRead = mocks.queryFn!();
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); confirmLatest();
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce()); });
  const uncertainId = mocks.markPaid.mock.calls.find(([id]) => id === 2)![2];
  finish({ success: true, data: serverSnapshot([1, 2]) });
  await oldRead;
  mocks.markPaid.mockClear();
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); confirmLatest();
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2)); });
  expect(mocks.markPaid.mock.calls.map(([id]) => id)).toEqual([2]);
  expect(mocks.markPaid.mock.calls[0][2]).toBe(uncertainId);
});

it('does not treat a successful cached refetch result as fresh server payment state', async () => {
  mocks.refetch.mockResolvedValue({ isSuccess: true, data: serverSnapshot([1, 2]) });
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); confirmLatest();
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce()); });
  const uncertainId = mocks.markPaid.mock.calls.find(([id]) => id === 2)![2];
  mocks.markPaid.mockClear();
  await act(async () => { mocks.actions!.onMarkPaid('Alex'); confirmLatest();
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2)); });
  expect(mocks.markPaid.mock.calls.map(([id]) => id)).toEqual([2]);
  expect(mocks.markPaid.mock.calls[0][2]).toBe(uncertainId);
});
