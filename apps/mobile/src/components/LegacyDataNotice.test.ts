import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mobileCoreResources } from '../features/mobileCoreResources';

const state = vi.hoisted(() => ({ authenticated: true, pending: true, synced: 'today' as string | null,
  alert: vi.fn() }));
vi.mock('react-native', () => ({
  Alert: { alert: state.alert }, Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: state.authenticated }) }));
vi.mock('../context/ServerProfileContext', () => ({ useServerProfiles: () => ({ activeProfile: { id: 'server' } }) }));
vi.mock('../context/MobileRuntimeContext', () => ({ useMobileRuntime: () => ({ lastSyncedAt: state.synced }) }));
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ colors: { surface: '#fff', text: '#000', warning: '#800', primary: '#050' } }) }));
vi.mock('../data/legacyQuarantine', async (original) => {
  const actual = await original<typeof import('../data/legacyQuarantine')>();
  return { ...actual, getLegacyDataStatus: vi.fn() };
});
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { hasData: true, hasPendingChanges: state.pending } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => mobileCoreResources.en.recovery[key.split('.').at(-1) as keyof typeof mobileCoreResources.en.recovery] }) }));
import LegacyDataNotice from './LegacyDataNotice';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(() => renderer!.unmount()); renderer = undefined;
  state.authenticated = true; state.pending = true; state.synced = 'today'; });

describe('earlier offline changes notice', () => {
  it('keeps the recovery warning and owner-verification guidance after normal synchronization', async () => {
    await act(() => { renderer = create(React.createElement(LegacyDataNotice)); });
    expect(JSON.stringify(renderer!.toJSON())).toContain(mobileCoreResources.en.recovery.recovery);
    const button = renderer!.root.findByProps({ accessibilityRole: 'button' });
    await act(() => button.props.onPress());
    expect(state.alert).toHaveBeenCalledWith(mobileCoreResources.en.recovery.help, mobileCoreResources.en.recovery.guidance);
    expect(mobileCoreResources.en.recovery.guidance).toContain('do not clear its data');
  });

  it('hides the reconnect-only notice after a safe download and hides all notices while signed out', async () => {
    state.pending = false; state.synced = null;
    await act(() => { renderer = create(React.createElement(LegacyDataNotice)); });
    expect(JSON.stringify(renderer!.toJSON())).toContain(mobileCoreResources.en.recovery.reconnect);
    state.synced = 'today';
    await act(() => renderer!.update(React.createElement(LegacyDataNotice)));
    expect(renderer!.toJSON()).toBeNull();
    state.pending = true; state.authenticated = false;
    await act(() => renderer!.update(React.createElement(LegacyDataNotice)));
    expect(renderer!.toJSON()).toBeNull();
  });
});
