import type { Bill } from '../../types';

/** Normalize RFC3339 to integer microseconds without discarding server precision. */
function version(value?: string | null): bigint | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const seconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(seconds)) return null;
  return BigInt(seconds) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}

/** Both independent versions must dominate; mixed/old cache snapshots cannot undo a fresh read. */
export function newerBillSnapshot(candidate: Bill | null, baseline: Bill): Bill {
  if (!candidate || candidate.id !== baseline.id || candidate.share_info?.share_id !== baseline.share_info?.share_id) return baseline;
  const incoming = [version(candidate.last_updated), version(candidate.share_info?.share_updated_at)];
  const current = [version(baseline.last_updated), version(baseline.share_info?.share_updated_at)];
  if (incoming.some((value) => value === null) || current.some((value) => value === null)) return baseline;
  return incoming.every((value, index) => value! >= current[index]!)
    && incoming.some((value, index) => value! > current[index]!) ? candidate : baseline;
}
