import { describe, expect, it } from 'vitest';

import { mobileParityResources } from './mobileParityResources';

function resourceShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(() => 'string');
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, resourceShape(nested)]),
    );
  }
  return typeof value;
}

function leafValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(leafValues);
}

function interpolationShape(value: unknown): unknown {
  if (typeof value === 'string') {
    return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
      .map((match) => match[1])
      .sort();
  }
  if (!value || typeof value !== 'object') return [];
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, interpolationShape(nested)]),
  );
}

describe('mobile parity translations', () => {
  it('keeps English and German resource shapes in sync', () => {
    expect(resourceShape(mobileParityResources.de))
      .toEqual(resourceShape(mobileParityResources.en));
  });

  it('does not leave empty launch labels in either language', () => {
    expect(leafValues(mobileParityResources.en).every((value) => value.trim().length > 0)).toBe(true);
    expect(leafValues(mobileParityResources.de).every((value) => value.trim().length > 0)).toBe(true);
  });

  it('keeps interpolation variables aligned between languages', () => {
    expect(interpolationShape(mobileParityResources.de))
      .toEqual(interpolationShape(mobileParityResources.en));
  });

  it('explains that synchronization is automatic and only conflicts need input', () => {
    expect(mobileParityResources.en.conflicts).toMatchObject({
      screenTitle: 'Sync & offline data',
      connected: 'Connected · sync is automatic',
      syncNow: 'Retry now',
      noDecisions: 'No conflicts need your input',
    });
    expect(mobileParityResources.en.conflicts.retryQueued).toContain('syncs changes automatically');
    expect(mobileParityResources.en.conflicts.retryQueued).toContain('only need to choose');

    expect(mobileParityResources.de.conflicts).toMatchObject({
      screenTitle: 'Synchronisierung & Offline-Daten',
      syncNow: 'Jetzt erneut versuchen',
    });
    expect(mobileParityResources.de.conflicts.retryQueued).toContain('automatisch');
  });
});
