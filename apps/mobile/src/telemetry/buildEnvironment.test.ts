import { describe, expect, it } from 'vitest';
import { resolveBuildEnvironment } from './buildEnvironment';

describe('embedded release environment with OTA disabled', () => {
  it.each(['preview', 'production'] as const)('preserves %s with a null Updates.channel', (environment) => {
    expect(resolveBuildEnvironment(environment, null, false)).toBe(environment);
  });
  it('does not mistake a development runtime for a store build', () => {
    expect(resolveBuildEnvironment('production', null, true)).toBe('development');
  });
  it('uses only known legacy channels and rejects arbitrary environment metadata', () => {
    expect(resolveBuildEnvironment(undefined, 'preview', false)).toBe('preview');
    expect(resolveBuildEnvironment('private-value', 'private-channel', false)).toBe('production');
    expect(resolveBuildEnvironment({ arbitrary: 'value' }, null, false)).toBe('production');
  });
  it('uses the embedded build environment ahead of a stale native channel', () => {
    expect(resolveBuildEnvironment('preview', 'production', false)).toBe('preview');
  });
});
