export const allowsExternalPurchases = (platform: string): boolean => platform === 'ios';

export async function runBillingAction({ gate, allowed, isCurrent, isActive, request, openUrl, onBusy, onError }: {
  gate: { current: boolean };
  allowed: boolean;
  isCurrent: () => Promise<boolean>;
  isActive: () => boolean;
  request: () => Promise<{ success: boolean; data?: { url: string }; error?: string }>;
  openUrl: (url: string) => Promise<unknown>;
  onBusy: (busy: boolean) => void;
  onError: (message?: string) => void;
}): Promise<void> {
  if (!allowed || gate.current || !isActive()) return;
  gate.current = true;
  onBusy(true);
  try {
    if (!await isCurrent() || !isActive()) return;
    const response = await request();
    if (!await isCurrent() || !isActive()) return;
    if (!response.success || !response.data?.url) onError(response.error);
    else await openUrl(response.data.url);
  } catch {
    if (await isCurrent() && isActive()) onError();
  } finally {
    gate.current = false;
    onBusy(false);
  }
}
