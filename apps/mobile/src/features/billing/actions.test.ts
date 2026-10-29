import { describe, expect, it, vi } from 'vitest';
import { allowsExternalPurchases, runBillingAction } from './actions';

function fixture() {
  return { gate: { current: false }, allowed: true, isCurrent: vi.fn(async () => true),
    request: vi.fn(async () => ({ success: true, data: { url: 'https://checkout.stripe.com/test' } })),
    openUrl: vi.fn(async (): Promise<void> => undefined), onBusy: vi.fn(), onError: vi.fn() };
}

describe('native billing actions', () => {
  it('permits external purchases only in the US-only iOS release lane', () => {
    expect(allowsExternalPurchases('android')).toBe(false);
    expect(allowsExternalPurchases('ios')).toBe(true);
    expect(allowsExternalPurchases('web')).toBe(false);
  });
  it('never starts disabled purchases', async () => {
    const f = fixture();
    await runBillingAction({ ...f, allowed: false });
    expect(f.request).not.toHaveBeenCalled();
  });
  it('guards duplicate taps synchronously until URL opening finishes', async () => {
    const f = fixture();
    let finish!: () => void;
    f.openUrl.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = runBillingAction(f);
    await vi.waitFor(() => expect(f.openUrl).toHaveBeenCalledOnce());
    await runBillingAction(f);
    expect(f.request).toHaveBeenCalledOnce();
    finish(); await first;
    expect(f.gate.current).toBe(false);
    expect(f.onBusy.mock.calls).toEqual([[true], [false]]);
  });
  it('reports failed responses and URL rejections and releases the action guard', async () => {
    for (const failure of ['response', 'request', 'link']) {
      const f = fixture();
      if (failure === 'response') f.request.mockResolvedValue({ success: false, data: undefined as never });
      if (failure === 'request') f.request.mockRejectedValue(new Error('network'));
      if (failure === 'link') f.openUrl.mockRejectedValue(new Error('cannot open'));
      await runBillingAction(f);
      expect(f.onError).toHaveBeenCalledOnce();
      expect(f.gate.current).toBe(false);
    }
  });
  it('rejects stale-account callbacks and late checkout responses', async () => {
    const f = fixture();
    f.isCurrent.mockResolvedValue(false);
    await runBillingAction(f);
    expect(f.request).not.toHaveBeenCalled();
    f.isCurrent.mockResolvedValueOnce(true).mockResolvedValue(false);
    await runBillingAction(f);
    expect(f.openUrl).not.toHaveBeenCalled();
  });
});
