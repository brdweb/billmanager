import { getStateFromPath } from '@react-navigation/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-linking', () => ({ createURL: vi.fn(() => 'billmanager://auth/callback') }));
vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import { linking } from './linking';

describe('mobile deep links', () => {
  it.each([
    ['/verify-email?token=verify-token', 'VerifyEmail', 'verify-token'],
    ['/reset-password?token=reset-token', 'ResetPassword', 'reset-token'],
    ['/accept-invite?token=team-token', 'AcceptInvite', 'team-token'],
    ['/accept-share-invite?token=share-token', 'AcceptShareInvite', 'share-token'],
  ])('parses the canonical web link %s', (path, routeName, token) => {
    const state = getStateFromPath(path, linking.config);
    const authState = state?.routes[0]?.state;
    const route = authState?.routes[0];

    expect(state?.routes[0]?.name).toBe('Auth');
    expect(route?.name).toBe(routeName);
    expect(route?.params).toMatchObject({ token });
  });

  it('parses bill notification routes as numeric IDs', () => {
    const state = getStateFromPath('/bills/42', linking.config);
    const mainState = state?.routes[0]?.state;
    const billsState = mainState?.routes.find((route) => route.name === 'BillsTab')?.state;
    const detail = billsState?.routes.find((route) => route.name === 'BillDetail');

    expect(detail?.params).toMatchObject({ billId: 42 });
  });
});
