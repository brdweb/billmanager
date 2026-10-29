export const allowsExternalPurchases = (platform: string): boolean => platform === 'ios';

export async function runBillingAction({ gate, allowed, isCurrent, request, openUrl, onBusy, onError }: {
  gate: { current: boolean };
  allowed: boolean;
  isCurrent: () => Promise<boolean>;
  request: () => Promise<{ success: boolean; data?: { url: string }; error?: string }>;
  openUrl: (url: string) => Promise<unknown>;
  onBusy: (busy: boolean) => void;
  onError: (message?: string) => void;
}): Promise<void> {
  if (!allowed || gate.current) return;
  gate.current = true;
  onBusy(true);
  try {
    if (!await isCurrent()) return;
    const response = await request();
    if (!await isCurrent()) return;
    if (!response.success || !response.data?.url) onError(response.error);
    else await openUrl(response.data.url);
  } catch {
    if (await isCurrent()) onError();
  } finally {
    gate.current = false;
    onBusy(false);
  }
}
