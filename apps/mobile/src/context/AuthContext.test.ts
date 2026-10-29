import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ principalId: undefined as string | undefined,
  status: undefined as number | undefined, live: false, bind: vi.fn(), save: vi.fn() }));
const cached = { user: { id: 1, username: 'alice', role: 'user' },
  databases: [{ id: 1, name: 'family', display_name: 'Family' }], currentDatabase: 'family', updatedAt: 'today' };
vi.mock('../api/client', () => ({ api: {
  getActiveProfile: () => ({ id: 'server', deploymentMode: 'saas', capabilities: {} }),
  hasActiveAccessToken: () => true, getCurrentDatabase: () => 'family',
  captureAuthSessionScope: () => ({ serverProfileId: 'server', databaseId: 'family',
    ...(state.principalId ? { principalId: state.principalId } : {}) }),
  getUserInfo: async () => state.live
    ? { success: true, data: { user: { id: 2, username: 'bob', role: 'user' }, databases: [{ id: 1, name: 'family', display_name: 'Family' }] } }
    : { success: false, httpStatus: state.status, error: 'offline' },
  bindAuthenticatedPrincipal: (...args: unknown[]) => state.bind(...args),
  setAuthErrorHandler: vi.fn(), setCurrentDatabase: vi.fn(),
} }));
vi.mock('../data/authSessionRepository', () => ({ SQLiteAuthSessionStore: class {
  async get() { return cached; }
  save(...args: unknown[]) { return state.save(...args); }
  clear = vi.fn();
} }));
vi.mock('../native/localNotifications', () => ({ cancelOtherPrincipalReminders: async () => undefined, cancelPrincipalReminders: async () => undefined }));
vi.mock('../i18n', () => ({ default: { resolvedLanguage: 'en', language: 'en' } }));
vi.mock('../i18n/format', () => ({ configureFormatting: vi.fn() }));
import { AuthProvider, useAuth } from './AuthContext';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReactTestRenderer | undefined;
let latest: ReturnType<typeof useAuth>;
function Probe() { latest = useAuth(); return null; }
async function mount() {
  await act(async () => { root = create(React.createElement(AuthProvider, { children: React.createElement(Probe) })); });
  await vi.waitFor(() => expect(latest.isLoading).toBe(false));
}
afterEach(async () => { if (root) await act(() => root!.unmount()); root = undefined;
  state.principalId = undefined; state.status = undefined; state.live = false; vi.clearAllMocks(); });

describe('cached offline authentication ownership', () => {
  it.each([undefined, 503])('does not bind an unowned legacy token to a cached user on response %s', async (status) => {
    state.status = status;
    await mount();
    expect(latest.isAuthenticated).toBe(false);
    expect(latest.user).toBeNull();
    expect(latest.requiresOnlineIdentityVerification).toBe(true);
    expect(state.bind).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it('preserves offline access when the atomic credential owner matches the cached account', async () => {
    state.principalId = '1'; state.status = 503;
    await mount();
    expect(latest.isAuthenticated).toBe(true);
    expect(latest.user?.id).toBe(1);
    expect(state.bind).toHaveBeenCalledWith('1', false);
  });

  it('rejects a cached snapshot from another already-bound account', async () => {
    state.principalId = '2';
    await mount();
    expect(latest.isAuthenticated).toBe(false);
    expect(state.bind).not.toHaveBeenCalled();
  });

  it('allows a successful live identity response to establish a legacy token owner', async () => {
    state.live = true;
    await mount();
    expect(latest.isAuthenticated).toBe(true);
    expect(latest.user?.id).toBe(2);
    expect(state.bind).toHaveBeenCalledWith('2', true);
  });
});
