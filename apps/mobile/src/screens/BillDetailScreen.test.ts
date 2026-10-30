import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import Screen from './BillDetailScreen';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const m = vi.hoisted(() => ({
  profile: 'cloud',
  principal: 'owner',
  group: 'home',
  supported: true,
  paid: false,
  posts: vi.fn(),
  read: vi.fn(),
  sync: vi.fn(),
  alert: vi.fn(),
  verify: vi.fn(),
  bill: null as any,
}));
vi.mock('expo-crypto', () => ({
  randomUUID: () => globalThis.crypto.randomUUID(),
}));
vi.mock('../api/client', () => ({
  api: {
    captureAuthSessionScope: () => ({
      serverProfileId: m.profile,
      principalId: m.principal,
      databaseId: m.group,
    }),
    markSharePaid: m.posts,
    requestScopedGet: m.read,
  },
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: m.principal }, currentDatabase: m.group }),
}));
vi.mock('../context/ServerProfileContext', () => ({
  useServerProfiles: () => ({
    activeProfile: {
      id: m.profile,
      capabilities: { settlementPaymentDesiredState: m.supported },
    },
    verifyActiveProfile: m.verify,
  }),
}));
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  Switch: 'Switch',
  StyleSheet: { create: (x: unknown) => x },
  Alert: { alert: m.alert },
  Platform: { OS: 'ios' },
}));
vi.mock('@react-native-community/datetimepicker', () => ({
  default: 'DateTimePicker',
}));
vi.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  default: 'Swipeable',
}));
vi.mock('../components/ShareBillModal', () => ({ default: () => null }));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ colors: {} }),
}));
vi.mock('../context/MobileRuntimeContext', () => ({
  useMobileRuntime: () => ({
    bills: [m.bill],
    archivedBills: [],
    payments: [],
    online: true,
    syncNow: m.sync,
  }),
}));
vi.mock('../i18n/format', () => ({
  formatCurrency: String,
  formatDate: String,
  getMoneyInputProps: () => ({}),
  parseMoneyInput: Number,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (x: string) => x }),
}));
let root: any;
const props = { route: { params: { billId: 1 } }, navigation: {} } as any;
function bill(paid = false, version = '2026-10-29T12:00:00Z') {
  return {
    id: 1,
    name: 'Rent',
    amount: 20,
    last_updated: version,
    next_due: '2026-10-29',
    frequency: 'monthly',
    type: 'expense',
    is_shared: true,
    share_info: {
      share_id: 7,
      share_updated_at: version,
      owner_name: 'Owner',
      my_portion: 10,
      my_portion_paid: paid,
    },
  };
}
const button = () =>
  root.root
    .findAllByType('TouchableOpacity')
    .find((x: any) =>
      x
        .findAllByType('Text')
        .some((t: any) =>
          ['common.markMyPortionPaid', 'common.markAsUnpaid'].includes(
            t.props.children,
          ),
        ),
    );
const press = () =>
  act(async () => {
    await button().props.onPress();
  });
const update = () =>
  act(async () => {
    root.update(React.createElement(Screen, props));
  });
const refresh = () =>
  act(async () => {
    await m.alert.mock.calls.at(-1)![2][1].onPress();
    await vi.waitFor(() => expect(m.read).toHaveBeenCalled());
  });
beforeEach(async () => {
  m.profile = 'cloud';
  m.principal = 'owner';
  m.group = 'home';
  m.supported = true;
  m.bill = bill();
  m.posts
    .mockReset()
    .mockResolvedValue({ success: false, error: 'Network response lost' });
  m.alert.mockReset();
  m.read.mockReset().mockResolvedValue({ success: true, data: bill() });
  m.sync.mockReset().mockResolvedValue(null);
  m.verify.mockReset().mockResolvedValue(null);
  await act(async () => {
    root = create(React.createElement(Screen, props));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it.each([false, true])(
  'pins desired state and complete original tuple across unknown retry (paid=%s)',
  async (paid) => {
    m.bill = bill(paid);
    await update();
    await press();
    m.bill = bill(!paid, '2026-10-30T12:00:00Z');
    m.bill.amount = 40;
    m.bill.next_due = '2026-11-29';
    await update();
    await press();
    expect(m.posts).toHaveBeenCalledTimes(2);
    expect(m.posts.mock.calls[1]).toEqual(m.posts.mock.calls[0]);
    expect(m.posts.mock.calls[0]).toEqual([
      7,
      { serverProfileId: 'cloud', principalId: 'owner', databaseId: 'home' },
      expect.any(String),
      expect.objectContaining({
        desiredPaid: !paid,
        baseUpdatedAt: '2026-10-29T12:00:00Z',
        baseBillUpdatedAt: '2026-10-29T12:00:00Z',
        expectedDueDate: '2026-10-29',
      }),
    ]);
    expect(m.sync).not.toHaveBeenCalled();
  },
);
it('409 blocks further dispatch until explicit fresh read, then creates a new reviewed intent', async () => {
  m.posts.mockResolvedValue({ success: false, httpStatus: 409 });
  await press();
  const original = m.posts.mock.calls[0];
  await press();
  expect(m.posts).toHaveBeenCalledTimes(1);
  m.read.mockResolvedValue({
    success: true,
    data: bill(true, '2026-10-30T12:00:00Z'),
  });
  await refresh();
  expect(m.posts).toHaveBeenCalledTimes(1);
  await press();
  expect(m.posts.mock.calls[1][2]).not.toBe(original[2]);
  expect(m.posts.mock.calls[1][3]).toMatchObject({
    desiredPaid: false,
    baseUpdatedAt: '2026-10-30T12:00:00Z',
  });
});
it('successful payment refreshes actual bill before allowing opposite desired state', async () => {
  m.posts.mockResolvedValue({ success: true });
  m.read.mockResolvedValue({
    success: true,
    data: bill(true, '2026-10-30T12:00:00Z'),
  });
  await press();
  expect(m.read).toHaveBeenCalledWith(
    '/bills/1',
    expect.objectContaining({ principalId: 'owner' }),
  );
  await press();
  expect(m.posts.mock.calls[1][3].desiredPaid).toBe(false);
  expect(m.posts.mock.calls[1][2]).not.toBe(m.posts.mock.calls[0][2]);
});
it('failed fresh read retains blocked intent without dispatching again', async () => {
  m.posts.mockResolvedValue({ success: true });
  m.read.mockResolvedValue({ success: false });
  await press();
  await press();
  expect(m.posts).toHaveBeenCalledOnce();
});
it.each(['profile', 'principal', 'group'])(
  'ignores retained callbacks and late responses after %s change',
  async (field) => {
    let resolve: any;
    m.posts.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const stale = button().props.onPress;
    await act(async () => {
      void stale();
    });
    (m as any)[field] = 'other';
    await update();
    await act(async () => {
      resolve({ success: true });
      await stale();
    });
    expect(m.posts).toHaveBeenCalledOnce();
    expect(m.read).not.toHaveBeenCalled();
    expect(m.sync).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  },
);
it('consumes duplicate taps synchronously', async () => {
  let resolve: any;
  m.posts.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    void button().props.onPress();
    void button().props.onPress();
  });
  expect(m.posts).toHaveBeenCalledOnce();
  await act(async () => resolve({ success: false }));
});
it('old preconditions-only server cannot authorize detail changes', async () => {
  m.supported = false;
  await update();
  await press();
  expect(m.posts).not.toHaveBeenCalled();
  await act(async () => {
    await m.alert.mock.calls.at(-1)![2][1].onPress();
  });
  expect(m.verify).toHaveBeenCalledOnce();
  expect(m.posts).not.toHaveBeenCalled();
});
it.each(['last_updated', 'share_updated_at'])(
  'fails closed missing %s',
  async (field) => {
    if (field === 'last_updated') delete m.bill.last_updated;
    else delete m.bill.share_info.share_updated_at;
    await update();
    await press();
    expect(m.posts).not.toHaveBeenCalled();
  },
);
it('ignores response and retained action after unmount', async () => {
  let resolve: any;
  m.posts.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const stale = button().props.onPress;
  await act(async () => {
    void stale();
    root.unmount();
  });
  await act(async () => {
    resolve({ success: true });
    await stale();
  });
  expect(m.read).not.toHaveBeenCalled();
  expect(m.posts).toHaveBeenCalledOnce();
});

it('ignores fresh-read results after account switch, even with retained credentials', async () => {
  let resolve: (value: unknown) => void = () => {};
  m.posts.mockResolvedValue({ success: true });
  m.read.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    void button().props.onPress();
  });
  expect(m.read).toHaveBeenCalledOnce();
  m.principal = 'other';
  await update();
  await act(async () => {
    resolve({ success: true, data: bill(true) });
  });
  expect(m.sync).not.toHaveBeenCalled();
  expect(button().findAllByType('Text')[0].props.children).toBe(
    'common.markMyPortionPaid',
  );
});

it('expires retained actions when the mounted detail changes bill', async () => {
  const stale = button().props.onPress;
  m.bill = { ...bill(), id: 2 };
  await act(async () => {
    root.update(
      React.createElement(Screen, {
        ...props,
        route: { params: { billId: 2 } },
      }),
    );
  });
  await act(async () => {
    await stale();
  });
  expect(m.posts).not.toHaveBeenCalled();
});

it('adopts newer runtime versions after refresh and rejects older replay at microsecond precision', async () => {
  m.posts.mockResolvedValue({ success: true });
  m.read.mockResolvedValue({ success: true, data: bill(true, '2026-10-29T12:00:00.123455+00:00') });
  await press();
  m.bill = { ...bill(false, '2026-10-29T12:00:00.123456+00:00'), amount: 40, next_due: '2026-11-29' };
  await update();
  const visible = () => root.root.findAllByType('Text').map((node: any) => node.children.join(''));
  expect(visible()).toContain('-40');
  expect(visible()).toContain('2026-11-29');
  expect(button().findAllByType('Text')[0].props.children).toBe('common.markMyPortionPaid');
  m.bill = { ...bill(true, '2026-10-29T12:00:00.123455Z'), amount: 20 };
  await update();
  expect(visible()).toContain('-40');
  expect(visible()).toContain('2026-11-29');
  m.posts.mockResolvedValue({ success: false, error: 'unknown' });
  await press();
  expect(m.posts.mock.calls[1][3]).toMatchObject({ desiredPaid: true, baseUpdatedAt: '2026-10-29T12:00:00.123456+00:00', baseBillUpdatedAt: '2026-10-29T12:00:00.123456+00:00', expectedDueDate: '2026-11-29' });
});
