import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadTokens: vi.fn(),
  getPermissions: vi.fn(),
  getScheduled: vi.fn(),
  cancelScheduled: vi.fn(),
  schedule: vi.fn(),
  addResponseListener: vi.fn(),
}));

vi.mock('../api/tokenStore', () => ({ SecureProfileTokenStore: class { load = mocks.loadTokens; } }));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  setNotificationCategoryAsync: vi.fn(),
  getPermissionsAsync: mocks.getPermissions,
  requestPermissionsAsync: vi.fn(),
  getAllScheduledNotificationsAsync: mocks.getScheduled,
  cancelScheduledNotificationAsync: mocks.cancelScheduled,
  scheduleNotificationAsync: mocks.schedule,
  addNotificationResponseReceivedListener: mocks.addResponseListener,
}));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../i18n/format', () => ({ formatCurrency: (value: number) => String(value) }));

import type { Bill } from '../types';
import {
  NOTIFICATION_ACTIONS,
  scheduleLocalBillReminders,
  snoozeLocalBillReminder,
  subscribeToNotificationActions,
} from './localNotifications';

const bill = {
  id: 41,
  name: 'Rent',
  amount: 1200,
  frequency: 'monthly',
  frequency_type: 'simple',
  frequency_config: '{}',
  next_due: '2026-08-15',
  reminder_enabled: true,
  reminder_days: [7],
  archived: false,
  type: 'expense',
} as Bill;

describe('profile-scoped local notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPermissions.mockResolvedValue({ granted: true });
    mocks.schedule.mockResolvedValue('scheduled');
    mocks.loadTokens.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', principalId: '1' });
  });

  it('replaces reminders only inside the requested server and database scope', async () => {
    mocks.getScheduled.mockResolvedValue([
      { identifier: 'same', content: { data: { source: 'billmanager-local-reminder', serverProfileId: 'server-a', principalId: '1', databaseId: 'home' } } },
      { identifier: 'other-profile', content: { data: { source: 'billmanager-local-reminder', serverProfileId: 'server-b', principalId: '1', databaseId: 'home' } } },
      { identifier: 'other-database', content: { data: { source: 'billmanager-local-reminder', serverProfileId: 'server-a', principalId: '1', databaseId: 'work' } } },
    ]);

    await scheduleLocalBillReminders([bill], {
      scope: { serverProfileId: 'server-a', principalId: '1', databaseId: 'home' },
      now: new Date(2026, 6, 15, 9),
    });

    expect(mocks.cancelScheduled).toHaveBeenCalledTimes(1);
    expect(mocks.cancelScheduled).toHaveBeenCalledWith('same');
    expect(mocks.schedule).toHaveBeenCalledWith(expect.objectContaining({
      identifier: expect.stringMatching(/^server-a:1:home:bill-41-/),
      content: expect.objectContaining({
        data: expect.objectContaining({
          billId: 41,
          serverProfileId: 'server-a',
          databaseId: 'home',
        }),
      }),
    }));
  });

  it('passes the notification scope to Mark Paid and ignores legacy unscoped actions', async () => {
    let listener: ((response: any) => Promise<void>) | undefined;
    mocks.addResponseListener.mockImplementation((callback) => {
      listener = callback;
      return { remove: vi.fn() };
    });
    const onMarkPaid = vi.fn();
    subscribeToNotificationActions({ onOpenBill: vi.fn(), onMarkPaid });

    await listener?.({
      actionIdentifier: NOTIFICATION_ACTIONS.markPaid,
      notification: { request: { content: { data: { billId: 41 } } } },
    });
    await listener?.({
      actionIdentifier: NOTIFICATION_ACTIONS.markPaid,
      notification: { request: { content: { data: { billId: 41, serverProfileId: 'server-a', principalId: '1', databaseId: 'home' } } } },
    });

    expect(onMarkPaid).toHaveBeenCalledTimes(1);
    expect(onMarkPaid).toHaveBeenCalledWith(41, { serverProfileId: 'server-a', principalId: '1', databaseId: 'home' });
  });
  it('does not schedule an old account reminder with the next account credentials', async () => {
    mocks.loadTokens.mockResolvedValue({ accessToken: 'bob', principalId: '2' });
    expect(await scheduleLocalBillReminders([bill], {
      scope: { serverProfileId: 'server', principalId: '1', databaseId: 'family' },
    })).toBe(0);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('removes just-created reminders when the account changes during native scheduling', async () => {
    mocks.getScheduled.mockResolvedValue([]);
    mocks.schedule.mockImplementation(async () => {
      mocks.loadTokens.mockResolvedValue({ accessToken: 'bob', principalId: '2' });
      return 'alice-reminder';
    });
    expect(await scheduleLocalBillReminders([bill], {
      scope: { serverProfileId: 'server', principalId: '1', databaseId: 'family' },
      now: new Date(2026, 6, 15, 9),
    })).toBe(0);
    expect(mocks.schedule).toHaveBeenCalled();
    expect(mocks.cancelScheduled).toHaveBeenCalledWith('alice-reminder');
  });

  it('rejects stale-account notification actions before snoozing or marking paid', async () => {
    const onMarkPaid = vi.fn();
    const onSnooze = vi.fn();
    subscribeToNotificationActions({ onOpenBill: vi.fn(), onMarkPaid, onSnooze,
      isScopeAuthorized: async () => false });
    const listener = mocks.addResponseListener.mock.calls[0][0];
    const notification = { request: { content: { data: { billId: 41, serverProfileId: 'server', principalId: '1', databaseId: 'family' } } } };
    await listener({ actionIdentifier: NOTIFICATION_ACTIONS.markPaid, notification });
    await listener({ actionIdentifier: NOTIFICATION_ACTIONS.snooze, notification });
    expect(onMarkPaid).not.toHaveBeenCalled();
    expect(onSnooze).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('cancels a snooze that finishes after account revocation', async () => {
    const scope = { serverProfileId: 'server', databaseId: 'family', principalId: '1' };
    let resolveSchedule!: (id: string) => void;
    mocks.schedule.mockImplementation(() => new Promise<string>((resolve) => { resolveSchedule = resolve; }));
    const pending = snoozeLocalBillReminder(bill, scope);
    await vi.waitFor(() => expect(mocks.schedule).toHaveBeenCalled());
    mocks.loadTokens.mockResolvedValue({ accessToken: 'bob', principalId: '2' });
    resolveSchedule('old-snooze');
    expect(await pending).toBeNull();
    expect(mocks.cancelScheduled).toHaveBeenCalledWith('old-snooze');
  });

  it('rejects unqualified legacy scheduling', async () => {
    expect(await snoozeLocalBillReminder(bill, { serverProfileId: 'server', databaseId: 'family' })).toBeNull();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('cancels a notification-action snooze that completes after logout', async () => {
    let finish!: (id: string) => void;
    mocks.schedule.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const onSnooze = vi.fn();
    subscribeToNotificationActions({ onOpenBill: vi.fn(), onMarkPaid: vi.fn(), onSnooze });
    const listener = mocks.addResponseListener.mock.calls[0][0];
    const pending = listener({ actionIdentifier: NOTIFICATION_ACTIONS.snooze,
      notification: { request: { content: { title: 'Alice bill', data: {
        billId: 41, serverProfileId: 'server', databaseId: 'family', principalId: '1',
      } } } } });
    await vi.waitFor(() => expect(mocks.schedule).toHaveBeenCalled());
    mocks.loadTokens.mockResolvedValue({ accessToken: null, refreshToken: null });
    finish('late-action-snooze');
    await pending;
    expect(mocks.cancelScheduled).toHaveBeenCalledWith('late-action-snooze');
    expect(onSnooze).not.toHaveBeenCalled();
  });

});
