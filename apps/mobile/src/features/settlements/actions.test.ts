import { expect, it, vi } from 'vitest';
import { settleOutstandingShares } from './actions';

it('reports partial API failures and retries only failed shares', async () => {
  const confirmed = new Set<number>();
  const markPaid = vi.fn(async (id: number) => ({ success: id !== 2 }));
  const result = await settleOutstandingShares([1, 2, 3, 1], confirmed, markPaid, async () => true);
  expect(result).toEqual({ succeeded: [1, 3], failed: [2] });
  markPaid.mockClear().mockResolvedValue({ success: true });
  expect(await settleOutstandingShares([1, 2, 3], confirmed, markPaid, async () => true)).toEqual({ succeeded: [2], failed: [] });
  expect(markPaid.mock.calls).toEqual([[2]]);
});
it('continues after a rejected request and reports the failed share', async () => {
  const markPaid = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ success: true });
  expect(await settleOutstandingShares([1, 2], new Set(), markPaid, async () => true)).toEqual({ succeeded: [2], failed: [1] });
});
it('does not dispatch a stale dialog or continue a batch after account switch', async () => {
  const markPaid = vi.fn(async () => ({ success: true }));
  const isCurrent = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  expect(await settleOutstandingShares([1, 2], new Set(), markPaid, isCurrent)).toEqual({ succeeded: [1], failed: [] });
  expect(markPaid).toHaveBeenCalledOnce();
  markPaid.mockClear();
  await settleOutstandingShares([1], new Set(), markPaid, async () => false);
  expect(markPaid).not.toHaveBeenCalled();
});
