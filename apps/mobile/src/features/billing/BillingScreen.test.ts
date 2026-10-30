import React from 'react';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import BillingScreen from './BillingScreen';
import type { BillingViewModel } from './models';

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (element: React.ReactNode) => string };

vi.mock('react-native', () => {
  const host = (tag: string) => ({ children, disabled, accessibilityLabel }: { children?: React.ReactNode; disabled?: boolean; accessibilityLabel?: string }) => React.createElement(tag, { disabled, 'aria-label': accessibilityLabel }, children);
  return { Platform: { OS: 'android' }, StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
    View: host('div'), Text: host('span'), ScrollView: host('main'), Pressable: host('button'), ActivityIndicator: host('span'), RefreshControl: () => null };
});
vi.mock('lucide-react-native', () => Object.fromEntries(['Check', 'ChevronRight', 'Crown', 'ExternalLink', 'Infinity', 'Server', 'Sparkles'].map((key) => [key, 'i'])));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../design/useAdaptiveTheme', () => ({ useAdaptiveTheme: () => ({ colors: {}, minimumHitSize: 48 }) }));
vi.mock('../../design/useAndroidTopInset', () => ({ useAndroidTopInset: () => 0 }));
vi.mock('../../design/useAdaptiveLayout', () => ({ useAdaptiveLayout: () => ({ horizontalPadding: 16 }) }));
vi.mock('../../components/adaptive/AdaptiveSurface', () => ({ default: ({ children }: { children: React.ReactNode }) => React.createElement('section', null, children) }));
vi.mock('../../components/adaptive/SectionHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('h2', null, title) }));

const model: BillingViewModel = { status: 'ready', offline: false, deploymentMode: 'saas', locale: 'en-US', currency: 'USD',
  subscription: { state: 'active', planName: 'Existing Pro account' }, usage: [], canManageBilling: true, canOpenPortal: true,
  plans: [{ id: 'pro-month', name: 'Pro', amount: 2.99, currency: 'USD', interval: 'month', description: 'Paid plan', features: [], current: false }] };
const actions = { onSelectPlan: vi.fn(), onOpenPortal: vi.fn(), onRefresh: vi.fn(), onRetry: vi.fn() };

describe('billing purchase surfaces', () => {
  it('keeps Android account status while removing prices, checkout and portal affordances', () => {
    const html = renderToStaticMarkup(React.createElement(BillingScreen, { model, actions, platform: 'android' }));
    expect(html).toContain('Existing Pro account');
    expect(html).not.toContain('billing.choose');
    expect(html).not.toContain('billing.openPortalA11y');
    expect(html).not.toContain('$2.99');
    expect(html).not.toContain('billing.availablePlans');
  });
  it('retains iOS purchase actions and disables both while a request is pending', () => {
    const html = renderToStaticMarkup(React.createElement(BillingScreen, { model: { ...model, actionBusy: true }, actions, platform: 'ios' }));
    expect(html).toContain('billing.choose');
    expect(html).toContain('billing.openPortalA11y');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});


it('hides a local Pro portal while retaining eligible iOS checkout actions', () => {
  const html = renderToStaticMarkup(React.createElement(BillingScreen, { model: { ...model, canOpenPortal: false }, actions, platform: 'ios' }));
  expect(html).toContain('Existing Pro account');
  expect(html).not.toContain('billing.openPortalA11y');
  expect(html).toContain('billing.choose');
});
it('retains the account-owner gate even when provider management is available', () => {
  const html = renderToStaticMarkup(React.createElement(BillingScreen, { model: { ...model, canManageBilling: false, canOpenPortal: true }, actions, platform: 'ios' }));
  expect(html).not.toContain('billing.openPortalA11y');
});
