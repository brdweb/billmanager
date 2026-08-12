import { describe, expect, it } from 'vitest';

import { mobileSettingsResources } from './mobileResources';

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

describe('mobile Settings translations', () => {
  it('keeps English and German resource shapes in sync', () => {
    expect(resourceShape(mobileSettingsResources.de))
      .toEqual(resourceShape(mobileSettingsResources.en));
  });

  it('presents synchronization as a destination rather than an offline-storage toggle', () => {
    expect(mobileSettingsResources.en.home.offlineStorage).toBe('Sync & offline data');
    expect(mobileSettingsResources.de.home.offlineStorage).toBe('Synchronisierung & Offline-Daten');
  });
});
