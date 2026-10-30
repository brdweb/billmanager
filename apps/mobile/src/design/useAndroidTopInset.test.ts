import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { HeaderShownContext } from '@react-navigation/elements';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import AnalyticsScreen from '../features/analytics/AnalyticsScreen';
import AdministrationScreen from '../features/administration/AdministrationScreen';
import CollaborationScreen from '../features/collaboration/CollaborationScreen';
import PaymentHistoryScreen from '../features/payments/PaymentHistoryScreen';
import SettlementsScreen from '../features/settlements/SettlementsScreen';
import BillingScreen from '../features/billing/BillingScreen';
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@react-navigation/elements', async () => {
  const React = await import('react');
  return { HeaderShownContext: React.createContext(false) };
});
vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react');
  return {
    SafeAreaInsetsContext: React.createContext({
      top: 32,
      bottom: 16,
      left: 0,
      right: 0,
    }),
  };
});
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  RefreshControl: 'RefreshControl',
  TextInput: 'TextInput',
  Modal: 'Modal',
}));
vi.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }));
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    [
      'ArrowDownLeft',
      'ArrowUpRight',
      'CalendarDays',
      'Check',
      'ChevronDown',
      'ChevronRight',
      'CircleDollarSign',
      'Clock3',
      'Crown',
      'Download',
      'ExternalLink',
      'FileText',
      'Infinity as InfinityIcon',
      'KeyRound',
      'Landmark',
      'Mail',
      'MailPlus',
      'Pencil',
      'Plus',
      'Printer',
      'RefreshCw',
      'Search',
      'Server',
      'Share2',
      'Shield',
      'SlidersHorizontal',
      'Sparkles',
      'Trash2',
      'TrendingDown',
      'TrendingUp',
      'UserCog',
      'UserRoundX',
      'UserX',
      'Users',
      'WalletCards',
      'X',
    ].map((key) => [key, () => null]),
  ),
);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./useAdaptiveTheme', () => ({
  useAdaptiveTheme: () => ({
    colors: {},
    radius: { pill: 999 },
    minimumHitSize: 48,
  }),
}));
vi.mock('./useAdaptiveLayout', () => ({
  useAdaptiveLayout: () => ({ horizontalPadding: 16 }),
}));
vi.mock('../components/adaptive/AdaptiveSurface', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('View', null, children),
}));
vi.mock('../components/adaptive/MoneyText', () => ({ default: () => null }));
vi.mock('../components/adaptive/SectionHeader', () => ({
  default: () => null,
}));
vi.mock('../components/adaptive/SegmentedControl', () => ({
  default: () => null,
}));

const model = {
  status: 'ready',
  offline: false,
  locale: 'en-US',
  currency: 'USD',
  bucketLabel: 'Home',
  summary: {
    paymentCount: 0,
    income: 0,
    expenses: 0,
    net: 0,
    owedToYou: 0,
    youOwe: 0,
    outstandingPeople: 0,
  },
  payments: [],
  people: [],
  recentHistory: [],
  sharedBills: [],
  pendingInvites: [],
  users: [],
  invites: [],
  groups: [],
  filters: {
    query: '',
    direction: 'all',
    dateRange: 'all',
    dateLabel: 'All dates',
    dateFrom: '',
    dateTo: '',
    minAmount: null,
    maxAmount: null,
    accountId: null,
    accountLabel: 'All accounts',
    categoryId: null,
    categoryLabel: 'All categories',
    bucketId: null,
    bucketLabel: 'All buckets',
  },
  page: 1,
  totalPages: 1,
  totalItems: 0,
  sort: 'date_desc',
  selectedSection: 'users',
  currentUserRole: 'owner',
  canCreateUsers: false,
  canCreateInvites: false,
  canCreateGroups: false,
  deploymentMode: 'saas',
  subscription: { state: 'active', planName: 'Pro' },
  plans: [],
  usage: [],
  canManageBilling: false,
  canOpenPortal: false,
  range: '12m',
  selectedYear: 2026,
  availableYears: [2026],
  yearPickerVisible: false,
  annual: { year: 2026, income: 0, expenses: 0, net: 0, savingsRate: 0 },
  yearOverYear: {
    currentYear: 2026,
    previousYear: 2025,
    incomeChangePercent: 0,
    expenseChangePercent: 0,
    netChange: 0,
  },
  categories: [],
  accounts: [],
  monthly: [{ key: '2026-10', label: 'Oct', income: 10, expenses: 5, net: 5 }],
  yearly: [],
  cashFlow: [],
};
const actions = new Proxy({}, { get: () => vi.fn() });
const screens = [
  AnalyticsScreen,
  AdministrationScreen,
  CollaborationScreen,
  PaymentHistoryScreen,
  SettlementsScreen,
  BillingScreen,
];
let root: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
});
function tree(
  Screen: (typeof screens)[number],
  platform: 'android' | 'ios',
  headerShown: boolean,
  top = 32,
) {
  return React.createElement(
    SafeAreaInsetsContext.Provider,
    { value: { top, bottom: 16, left: 0, right: 0 } },
    React.createElement(
      HeaderShownContext.Provider,
      { value: headerShown },
      React.createElement(Screen as React.ComponentType<any>, {
        model,
        actions,
        platform,
      }),
    ),
  );
}
function content() {
  const scroll = root!.root.findAll(
    (node) =>
      (node.type as unknown) === 'ScrollView' ||
      (node.type as unknown) === 'FlashList',
  )[0];
  const flatten = (value: any): any =>
    Array.isArray(value)
      ? Object.assign({}, ...value.map(flatten))
      : value || {};
  const viewport = root!.root.findAll(
    (node) => (node.type as unknown) === 'View',
  )[0];
  return {
    viewportTop: flatten(viewport.props.style).paddingTop ?? 0,
    style: flatten(scroll.props.contentContainerStyle),
    automatic: scroll.props.contentInsetAdjustmentBehavior,
  };
}
for (const Screen of screens) {
  it(`${Screen.name}: offsets headerless Android content below the actual status-bar inset`, async () => {
    await act(async () => {
      root = create(tree(Screen, 'android', false));
    });
    expect(content()).toMatchObject({
      viewportTop: 32,
      style: { paddingTop: 20 },
      automatic: 'automatic',
    });
  });
  it(`${Screen.name}: retains iOS automatic insets without adding explicit safe-area padding`, async () => {
    await act(async () => {
      root = create(tree(Screen, 'ios', false));
    });
    expect(content()).toMatchObject({
      viewportTop: 0,
      style: { paddingTop: 20 },
      automatic: 'automatic',
    });
  });
  it(`${Screen.name}: avoids double top spacing below a native Android navigation header`, async () => {
    await act(async () => {
      root = create(tree(Screen, 'android', true));
    });
    expect(content()).toMatchObject({
      viewportTop: 0,
      style: { paddingTop: 20 },
      automatic: 'automatic',
    });
  });
}
it('responds to inset and native-header context changes without accumulating padding', async () => {
  await act(async () => {
    root = create(tree(AnalyticsScreen, 'android', false));
  });
  await act(async () => {
    root!.update(tree(AnalyticsScreen, 'android', false, 48));
  });
  expect(content().viewportTop).toBe(48);
  expect(content().style.paddingTop).toBe(20);
  await act(async () => {
    root!.update(tree(AnalyticsScreen, 'android', true, 48));
  });
  expect(content().viewportTop).toBe(0);
  await act(async () => {
    root!.update(tree(AnalyticsScreen, 'android', false, 0));
  });
  expect(content().viewportTop).toBe(0);
});
