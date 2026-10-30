import { expect, it } from 'vitest';
import type { Bill } from '../../types';
import { newerBillSnapshot } from './billSnapshot';
const snapshot = (billVersion: string, shareVersion = billVersion) => ({
  id: 1, last_updated: billVersion, share_info: { share_id: 7, share_updated_at: shareVersion },
} as Bill);
const base = snapshot('2026-10-29T12:00:00.123455Z');
it('distinguishes adjacent server microseconds', () => {
  const next = snapshot('2026-10-29T12:00:00.123456Z');
  expect(newerBillSnapshot(next, base)).toBe(next);
  expect(newerBillSnapshot(base, next)).toBe(next);
});
it('normalizes offsets and fraction precision rather than comparing timestamp strings', () => {
  expect(newerBillSnapshot(snapshot('2026-10-29T13:00:00.123455+01:00'), base)).toBe(base);
  const next = snapshot('2026-10-29T07:00:00.123456-05:00');
  expect(newerBillSnapshot(next, base)).toBe(next);
  expect(newerBillSnapshot(snapshot('2026-10-29T12:00:00.1Z'), base)).toBe(base);
});
it('does not adopt a snapshot with an older independent share or bill version', () => {
  const older = '2026-10-29T12:00:00.123454Z';
  const newer = '2026-10-29T12:00:00.123456Z';
  expect(newerBillSnapshot(snapshot(newer, older), base)).toBe(base);
  expect(newerBillSnapshot(snapshot(older, newer), base)).toBe(base);
  const shareOnly = snapshot(base.last_updated!, newer);
  expect(newerBillSnapshot(shareOnly, base)).toBe(shareOnly);
});
it('rejects unversioned or mismatched snapshots', () => {
  expect(newerBillSnapshot(null, base)).toBe(base);
  expect(newerBillSnapshot(snapshot('invalid'), base)).toBe(base);
  expect(newerBillSnapshot({ ...base, id: 2 }, base)).toBe(base);
  expect(newerBillSnapshot({ ...base, share_info: undefined }, base)).toBe(base);
});
