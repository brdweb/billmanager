import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../context/AuthContext';
import * as api from '../api/client';
import { TokenStorage } from '../utils/tokenStorage';
const { setCurrency } = vi.hoisted(() => ({ setCurrency: vi.fn() }));
vi.mock('../context/ConfigContext', () => ({ useConfig: () => ({ setCurrency }) }));
vi.mock('../api/client', () => ({ refreshSession: vi.fn(), getMe: vi.fn(), loginWith2FA: vi.fn(), verify2FA: vi.fn() }));
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const user = { id: 2, username: 'managed', role: 'admin' as const, is_account_owner: false, currency: 'USD' };
const databases = [{ id: 1, name: 'personal', display_name: 'Personal', description: '' }];
beforeEach(() => {
  vi.resetAllMocks();
  const stored = new Map<string, string>();
  vi.mocked(localStorage.getItem).mockImplementation((key) => stored.get(key) ?? null);
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => { stored.set(key, value); });
  vi.mocked(localStorage.removeItem).mockImplementation((key) => { stored.delete(key); });
  TokenStorage.clearTokens();
  vi.mocked(api.refreshSession).mockResolvedValue(false);
});

it.each(['removed', null, '_all_', 'personal'])('recovers the saved group %s against current memberships', async (saved) => {
  TokenStorage.setTokens('test-access');
  if (saved) TokenStorage.setCurrentDatabase(saved);
  vi.mocked(api.getMe).mockResolvedValue({ user, databases });
  const { result } = renderHook(useAuth, { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.isLoggedIn).toBe(true);
  expect(result.current.currentDb).toBe(saved === '_all_' ? '_all_' : 'personal');
  expect(TokenStorage.getCurrentDatabase()).toBe(result.current.currentDb);
  expect(result.current.isAdmin).toBe(false);
});

it('does not grant owner controls to a managed admin after two-factor sign-in', async () => {
  vi.mocked(api.loginWith2FA).mockResolvedValue({ success: false, twofa_required: true, twofa_session_token: 'test-session', twofa_methods: ['recovery'] });
  vi.mocked(api.verify2FA).mockResolvedValue({ user, databases, access_token: 'test-access', expires_in: 900, token_type: 'Bearer' } as api.TwoFAVerifyResponse);
  const { result } = renderHook(useAuth, { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => { await result.current.login('managed', 'test-password'); });
  await act(async () => { await result.current.complete2FA('recovery', { recovery_code: 'test-code' }); });
  expect(result.current.isLoggedIn).toBe(true);
  expect(result.current.isAdmin).toBe(false);
});
