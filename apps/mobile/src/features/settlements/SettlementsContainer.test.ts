import React from 'react';
import { createRequire } from 'node:module';
import { beforeEach, expect, it, vi } from 'vitest';
import SettlementsContainer from './SettlementsContainer';
import type { SettlementsActions } from './models';

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (element: React.ReactNode) => string };
const mocks = vi.hoisted(() => ({
  alert: vi.fn(), markPaid: vi.fn(), current: vi.fn(), refetch: vi.fn(),
  actions: null as SettlementsActions | null,
  data: { summary: { owed_to_me: 0, i_owe: 30, net_balance: -30 }, people: [], settled: [], owed_to_me: [],
    i_owe: [1, 2].map((id) => ({ share_id: id, counterparty_name: 'Alex', bill_name: `Bill ${id}`, due_date: '2026-10-29', amount: 15 })) },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.data, refetch: mocks.refetch }) }));
vi.mock('../../api/client', () => ({ api: {
  captureAuthSessionScope: () => ({ serverProfileId: 'cloud', principalId: 'owner', databaseId: 'home' }),
  isPrincipalScopeAuthenticated: mocks.current, markSharePaid: mocks.markPaid,
} }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' }, currentDatabase: 'home', databases: [] }) }));
vi.mock('../../context/MobileRuntimeContext', () => ({ useMobileRuntime: () => ({ online: true }) }));
vi.mock('../../context/ServerProfileContext', () => ({ useServerProfiles: () => ({ activeProfile: { id: 'cloud', capabilities: { settlements: true } } }) }));
vi.mock('../../data/cacheRepository', () => ({ MobileCacheRepository: class {} }));
vi.mock('../../i18n/format', () => ({ getFormattingConfig: () => ({ locale: 'en-US', currency: 'USD' }), formatDate: (v: string) => v }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./SettlementsScreen', () => ({ default: ({ actions }: { actions: SettlementsActions }) => { mocks.actions = actions; return null; } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.current.mockResolvedValue(true);
  mocks.refetch.mockResolvedValue({});
  mocks.markPaid.mockImplementation(async (id: number) => ({ success: id !== 2 }));
  renderToStaticMarkup(React.createElement(SettlementsContainer));
});
function confirmLatest() {
  const buttons = mocks.alert.mock.calls.at(-1)?.[2] as { onPress: () => void }[];
  buttons[1].onPress();
}
it('shows partial failure details and never resubmits confirmed shares from stale data', async () => {
  mocks.actions!.onMarkPaid('Alex');
  mocks.actions!.onMarkPaid('Alex');
  expect(mocks.alert).toHaveBeenCalledOnce();
  confirmLatest();
  await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
  expect(mocks.alert.mock.calls[1][0]).toBe('settlementsPage.markPaidFailedTitle');
  expect(mocks.alert.mock.calls[1][1]).toContain('1/2');
  expect(mocks.alert.mock.calls[1][1]).toContain('Bill 2');
  const retryMutationId = mocks.markPaid.mock.calls.find(([id]) => id === 2)![2];
  mocks.markPaid.mockClear().mockResolvedValue({ success: true });
  mocks.actions!.onMarkPaid('Alex'); confirmLatest();
  await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2));
  expect(mocks.markPaid.mock.calls.map(([id]) => id)).toEqual([2]);
  expect(mocks.markPaid.mock.calls[0][2]).toBe(retryMutationId);
});
it('rejects an old-account confirmation after the dialog opens', async () => {
  mocks.actions!.onMarkPaid('Alex');
  mocks.current.mockResolvedValue(false);
  confirmLatest();
  await vi.waitFor(() => expect(mocks.current).toHaveBeenCalled());
  expect(mocks.markPaid).not.toHaveBeenCalled();
});
