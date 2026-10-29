export async function settleOutstandingShares(
  shareIds: number[],
  confirmed: Set<number>,
  markPaid: (id: number) => Promise<{ success: boolean; httpStatus?: number }>,
  isCurrent: () => Promise<boolean>,
  isActive: () => boolean,
): Promise<{ succeeded: number[]; failed: number[]; conflicted?: number[] }> {
  const succeeded: number[] = [];
  const failed: number[] = [];
  const conflicted: number[] = [];
  for (const id of new Set(shareIds)) {
    if (confirmed.has(id)) continue;
    if (!isActive() || !await isCurrent() || !isActive()) break;
    try {
      const response = await markPaid(id);
      if (response.success) {
        confirmed.add(id);
        succeeded.push(id);
      } else {
        failed.push(id);
        if (response.httpStatus === 409) conflicted.push(id);
      }
    } catch {
      failed.push(id);
    }
  }
  return { succeeded, failed, ...(conflicted.length ? { conflicted } : {}) };
}
