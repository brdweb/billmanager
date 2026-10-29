import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import * as api from '../api/client';
import { useScopedBills } from '../hooks/useScopedBills';
import type { Bill } from '../api/client';
vi.mock('../api/client', () => ({ getBills: vi.fn(), processAutoPayments: vi.fn() }));
const bill = (id: number) => ({ id, name: `Bill ${id}` }) as Bill;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.processAutoPayments).mockResolvedValue(undefined); });

it.each(['database', 'account'] as const)('rejects a late response after switching %s', async (change) => {
  const old = deferred<Bill[]>();
  vi.mocked(api.getBills).mockReturnValueOnce(old.promise).mockResolvedValueOnce([bill(2)]);
  const { result, rerender } = renderHook(({ user, db }) => useScopedBills(user, db), { initialProps: { user: 1, db: 'one' } });
  await waitFor(() => expect(api.getBills).toHaveBeenCalledTimes(1));
  rerender({ user: change === 'account' ? 2 : 1, db: change === 'database' ? 'two' : 'one' });
  expect(result.current.bills).toEqual([]);
  await waitFor(() => expect(result.current.bills).toEqual([bill(2)]));
  await act(async () => { old.resolve([bill(1)]); });
  expect(result.current.bills).toEqual([bill(2)]);
});

it('clears visible bills on logout and ignores an old refresh callback', async () => {
  vi.mocked(api.getBills).mockResolvedValue([bill(1)]);
  const { result, rerender } = renderHook(({ user }) => useScopedBills(user, 'one'), { initialProps: { user: 1 as number | null } });
  await waitFor(() => expect(result.current.bills).toEqual([bill(1)]));
  const oldRefresh = result.current.fetchBills;
  rerender({ user: null });
  expect(result.current.bills).toEqual([]);
  await act(oldRefresh);
  expect(api.getBills).toHaveBeenCalledTimes(1);
});

it('does not start a bill request after auto-payments finish in a previous group', async () => {
  const old = deferred<void>();
  vi.mocked(api.processAutoPayments).mockReturnValueOnce(old.promise).mockResolvedValueOnce(undefined);
  vi.mocked(api.getBills).mockResolvedValue([bill(2)]);
  const { result, rerender } = renderHook(({ db }) => useScopedBills(1, db), { initialProps: { db: 'one' } });
  rerender({ db: 'two' });
  await waitFor(() => expect(result.current.bills).toEqual([bill(2)]));
  await act(async () => { old.resolve(); });
  expect(api.getBills).toHaveBeenCalledTimes(1);
});
