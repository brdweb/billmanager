import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { AxiosError } from 'axios';
import transport, { type Bill, type SettlementItem } from '../api/client';
import { TokenStorage } from '../utils/tokenStorage';
import { Settlements } from '../pages/Settlements';
import { BillList } from '../components/BillList';

const state = vi.hoisted(() => ({ user: { id: 7 }, currentDb: 'Demo', isLoggedIn: true }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => state }));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));
const originalAdapter = transport.defaults.adapter;
const stamp = '2026-10-29T10:00:00Z';
let item: SettlementItem;
let bill: Bill;
let paid: boolean;
let supported: boolean;
let requests: Record<string, unknown>[];
let mode: 'lost' | 'conflict' | 'pending' | 'success';
let finish: (() => void) | undefined;
const refresh = vi.fn();
function credentials(id: number, database = 'Demo') {
  state.user = { id }; state.currentDb = database;
  TokenStorage.setTokens(`header.${btoa(JSON.stringify({ user_id: id }))}.synthetic`);
  TokenStorage.setCurrentDatabase(database);
}
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.mocked(localStorage.getItem).mockImplementation(key => storage.get(key) ?? null);
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => { storage.set(key, value); });
  vi.mocked(localStorage.removeItem).mockImplementation(key => { storage.delete(key); });
  credentials(7); paid = false; supported = true; requests = []; mode = 'lost'; finish = undefined; refresh.mockReset();
  item = { share_id: 5, bill_id: 4, bill_name: 'Synthetic shared bill', bill_icon: 'bill', bill_type: 'expense',
    database_id: 1, database_name: 'Demo', counterparty_name: 'Owner', counterparty_user_id: 2,
    amount: 50, total_amount: 100, due_date: '2026-10-29', days_until_due: 0, due_status: 'due_today',
    direction: 'i_owe', split_type: 'equal', split_value: null, paid: false,
    share_updated_at: stamp, bill_updated_at: stamp } as SettlementItem;
  bill = { id: 4, name: item.bill_name, amount: 100, next_due: item.due_date, last_updated: stamp,
    icon: 'bill', type: 'expense', frequency: 'monthly', frequency_type: 'simple', frequency_config: '{}',
    varies: false, auto_payment: false, paid: false, archived: false, account: null, created_at: stamp,
    is_shared: true, database_id: 1, share_info: { share_id: 5, owner_name: 'Owner', my_portion: 50,
      my_portion_paid: false, my_portion_paid_date: null, share_updated_at: stamp } };
  const completed = new Set<string>();
  transport.defaults.adapter = async config => {
    let data: unknown;
    if (config.url === '/config') data = { mobile: { features: {
      settlement_payment_preconditions: true, settlement_payment_desired_state: supported } } };
    else if (config.method === 'post') {
      const body = config.data ? JSON.parse(config.data) : {};
      requests.push(body);
      if (mode === 'conflict') throw new AxiosError('Changed', 'ERR_BAD_REQUEST', config, undefined,
        { status: 409, statusText: 'Conflict', headers: {}, config, data: { error: 'Refresh payment' } });
      if (!completed.has(body.client_mutation_id)) {
        paid = typeof body.desired_paid === 'boolean' ? body.desired_paid : !paid;
        if (body.client_mutation_id) completed.add(body.client_mutation_id);
      }
      if (mode === 'pending') await new Promise<void>(resolve => { finish = resolve; });
      if (mode === 'lost' && requests.length === 1) throw new Error('Response lost after server committed');
      data = { message: 'Updated', recipient_paid_date: paid ? stamp : null };
    } else if (config.url === '/settlements') data = { summary: { owed_to_me: 0, i_owe: 50, net_balance: -50,
      open_count: 1, settled_count: 0, overdue_owed_to_me: 0, overdue_i_owe: 0 },
      owed_to_me: [], i_owe: [item], settled: [], people: [] };
    else data = config.url?.startsWith('/bills') ? [bill] : [];
    return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data } };
  };
});
afterEach(() => { transport.defaults.adapter = originalAdapter; TokenStorage.clearTokens(); });
const wrapped = (child: React.ReactNode) => <MantineProvider>{child}</MantineProvider>;
const list = () => <BillList bills={[bill]} onRefresh={refresh} onEdit={vi.fn()} onPay={vi.fn()} onAdd={vi.fn()}
  onViewPayments={vi.fn()} isLoggedIn hasDatabase filter={{ searchQuery: '', dateRange: 'all', selectedDate: null, type: 'all', account: null, category: null }} onFilterChange={vi.fn()} />;

it('keeps the exact UUID/share/bill/due/desired tuple when a committed response is lost', async () => {
  render(wrapped(<Settlements hasDatabase />));
  fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark paid' })).not.toBeDisabled());
  expect(paid).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ desired_paid: true, base_updated_at: stamp, base_bill_updated_at: stamp, expected_due_date: item.due_date });
  expect(requests[0].client_mutation_id).toBeTruthy(); expect(paid).toBe(true);
});

it.each([false, true])('preserves intentional paid/unpaid state=%s through BillList unknown retries', async initiallyPaid => {
  paid = initiallyPaid; bill.share_info!.my_portion_paid = initiallyPaid;
  render(wrapped(list()));
  fireEvent.click(await screen.findByTitle(initiallyPaid ? 'Mark as unpaid' : 'Mark my portion as paid'));
  const name = initiallyPaid ? 'Mark Unpaid' : 'Confirm Paid';
  fireEvent.click(await screen.findByRole('button', { name }));
  await waitFor(() => expect(requests).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole('button', { name })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toEqual(requests[0]); expect(requests[0].desired_paid).toBe(!initiallyPaid); expect(paid).toBe(!initiallyPaid);
});

it('blocks both directions when only the older preconditions capability is advertised', async () => {
  supported = false; bill.share_info!.my_portion_paid = true;
  render(wrapped(list()));
  fireEvent.click(await screen.findByTitle('Mark as unpaid'));
  fireEvent.click(await screen.findByRole('button', { name: 'Mark Unpaid' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark Unpaid' })).not.toBeDisabled());
  expect(requests).toHaveLength(0);
});

it('rejects duplicate settlement clicks synchronously while a payment response is pending', async () => {
  mode = 'pending';
  render(wrapped(<Settlements hasDatabase />));
  const button = await screen.findByRole('button', { name: 'Mark paid' });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => { finish!(); });
  expect(requests).toHaveLength(1);
});

it.each(['account', 'group', 'modal', 'bill', 'unmount'] as const)('ignores late BillList response after %s changes', async change => {
  mode = 'pending'; vi.mocked(notifications.show).mockClear();
  const mounted = render(wrapped(list()));
  fireEvent.click(await screen.findByTitle('Mark my portion as paid'));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm Paid' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  if (change === 'account') credentials(8);
  if (change === 'group') credentials(7, 'Other');
  if (change === 'modal') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  if (change === 'bill') bill = { ...bill, last_updated: '2026-10-29T14:00:00Z' };
  if (change === 'unmount') mounted.unmount();
  else mounted.rerender(wrapped(list()));
  await act(async () => { finish!(); });
  expect(refresh).not.toHaveBeenCalled(); expect(notifications.show).not.toHaveBeenCalled();
});

it('never dispatches an old confirmation after the account changes during capability verification', async () => {
  const previous = transport.defaults.adapter as import('axios').AxiosAdapter;
  let allow!: () => void;
  transport.defaults.adapter = async config => {
    if (config.url === '/config') await new Promise<void>(resolve => { allow = resolve; });
    return previous(config);
  };
  const mounted = render(wrapped(list()));
  fireEvent.click(await screen.findByTitle('Mark my portion as paid'));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm Paid' }));
  await waitFor(() => expect(allow).toBeTypeOf('function'));
  credentials(8); mounted.rerender(wrapped(list()));
  await act(async () => { allow(); });
  expect(requests).toHaveLength(0);
});

it('creates a new intent with the fresh bill version after a definite conflict and server read', async () => {
  mode = 'conflict';
  render(wrapped(<Settlements hasDatabase />));
  fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark paid' })).not.toBeDisabled());
  item = { ...item, bill_updated_at: '2026-10-29T14:00:00Z' };
  fireEvent.click(screen.getByTitle('Refresh settlements'));
  await screen.findByRole('button', { name: 'Mark paid' });
  mode = 'success'; fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].client_mutation_id).not.toBe(requests[0].client_mutation_id);
  expect(requests[1].base_bill_updated_at).toBe(item.bill_updated_at);
});

it.each(['account', 'group'] as const)('rejects changed credential %s before the React context commits', async change => {
  render(wrapped(list()));
  fireEvent.click(await screen.findByTitle('Mark my portion as paid'));
  if (change === 'account') TokenStorage.setTokens(`header.${btoa(JSON.stringify({ user_id: 8 }))}.synthetic`);
  else TokenStorage.setCurrentDatabase('Other');
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm Paid' }));
  await act(async () => {});
  expect(requests).toHaveLength(0);
});

it('keeps the original uncertain intent even after a read supplies newer versions', async () => {
  render(wrapped(<Settlements hasDatabase />));
  fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark paid' })).not.toBeDisabled());
  item = { ...item, share_updated_at: '2026-10-29T13:00:00Z', bill_updated_at: '2026-10-29T14:00:00Z' };
  fireEvent.click(screen.getByTitle('Refresh settlements'));
  fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toEqual(requests[0]);
});
