import React from 'react';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import SettlementsScreen from './SettlementsScreen';
import type { SettlementsViewModel } from './models';
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (element: React.ReactNode) => string };
vi.mock('react-native', () => {
  const host = (tag: string) => ({ children, disabled, accessibilityLabel }: { children?: React.ReactNode; disabled?: boolean; accessibilityLabel?: string }) => React.createElement(tag, { disabled, 'aria-label': accessibilityLabel }, children);
  return { Platform: { OS: 'android' }, StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
    View: host('div'), Text: host('span'), ScrollView: host('main'), Pressable: host('button'), ActivityIndicator: host('span'), RefreshControl: () => null };
});
vi.mock('lucide-react-native', () => Object.fromEntries(['ArrowDownLeft', 'ArrowUpRight', 'Check', 'ChevronRight', 'Clock3', 'Users'].map((key) => [key, 'i'])));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../design/useAdaptiveTheme', () => ({ useAdaptiveTheme: () => ({ colors: {}, minimumHitSize: 48 }) }));
vi.mock('../../design/useAdaptiveLayout', () => ({ useAdaptiveLayout: () => ({ horizontalPadding: 16 }) }));
vi.mock('../../components/adaptive/AdaptiveSurface', () => ({ default: ({ children }: { children: React.ReactNode }) => React.createElement('section', null, children) }));
vi.mock('../../components/adaptive/MoneyText', () => ({ default: ({ amount }: { amount: number }) => React.createElement('span', null, amount) }));
vi.mock('../../components/adaptive/SectionHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('h2', null, title) }));
const actions = { onOpenPerson: vi.fn(), onMarkPaid: vi.fn(), onOpenHistory: vi.fn(), onRefresh: vi.fn(), onRetry: vi.fn() };
function model(direction: 'owes-you' | 'settled', canMarkPaid: boolean): SettlementsViewModel {
  return { status: 'ready', offline: false, locale: 'en-US', currency: 'USD', bucketLabel: 'Home',
    summary: { owedToYou: 20, youOwe: 10, net: 10, outstandingPeople: 1 }, recentHistory: [],
    people: [{ userId: 'Alex', displayName: 'Alex', balance: direction === 'settled' ? 0 : 10,
      direction, canMarkPaid, sharedBillCount: 2, lastActivityLabel: 'Open shares' }] };
}
describe('directional payable settlement controls', () => {
  it.each(['owes-you', 'settled'] as const)('shows Mark Paid for real outgoing debt despite net direction %s', (direction) => {
    const html = renderToStaticMarkup(React.createElement(SettlementsScreen, { model: model(direction, true), actions }));
    expect(html).toContain('settlements.markBalanceA11y');
  });
  it('does not offer Mark Paid when the person only owes the user', () => {
    const html = renderToStaticMarkup(React.createElement(SettlementsScreen, { model: model('owes-you', false), actions }));
    expect(html).not.toContain('settlements.markBalanceA11y');
  });
});
