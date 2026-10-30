import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Check, ChevronRight, Crown, ExternalLink, Infinity as InfinityIcon, Server, Sparkles } from 'lucide-react-native';

import AdaptiveSurface from '../../components/adaptive/AdaptiveSurface';
import SectionHeader from '../../components/adaptive/SectionHeader';
import { AdaptivePlatform, typography } from '../../design/tokens';
import { useAdaptiveLayout } from '../../design/useAdaptiveLayout';
import { useAdaptiveTheme } from '../../design/useAdaptiveTheme';
import {
  BillingActions,
  BillingPlanItem,
  BillingUsageItem,
  BillingViewModel,
  SubscriptionState,
  usagePercent,
} from './models';
import { useTranslation } from 'react-i18next';
import { allowsExternalPurchases } from './actions';
import type { TFunction } from 'i18next';

function localizedSubscriptionState(t: TFunction, state: SubscriptionState): string {
  const key: Record<SubscriptionState, string> = {
    free: 'billingPage.statusFree',
    trialing: 'billingPage.statusTrial',
    active: 'billingPage.statusActive',
    past_due: 'billingPage.statusPastDue',
    canceled: 'billingPage.statusCanceled',
    unlimited: 'billingPage.unlimited',
  };
  return t(key[state]);
}

export interface BillingScreenProps {
  model: BillingViewModel;
  actions: BillingActions;
  platform?: AdaptivePlatform;
}

function StatusPanel({ platform, title, body, loading, onRetry }: { platform: AdaptivePlatform; title: string; body: string; loading?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  return (
    <View style={[styles.state, { backgroundColor: theme.colors.background }]}>
      {loading ? <ActivityIndicator accessibilityLabel={t('mobileParity.billing.loadingTitle')} size="large" color={theme.colors.primary} /> : null}
      <Text accessibilityRole="header" style={[typography.section, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{body}</Text>
      {onRetry ? <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, { minHeight: theme.minimumHitSize, backgroundColor: theme.colors.primary, opacity: pressed ? 0.65 : 1 }]}><Text style={[typography.headline, { color: theme.colors.onPrimary }]}>{t('mobileParity.common.retry')}</Text></Pressable> : null}
    </View>
  );
}

function UsageRow({ usage, platform }: { usage: BillingUsageItem; platform: AdaptivePlatform }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const percent = usagePercent(usage);
  const label = usage.limit === null ? t('mobileParity.billing.unlimitedUsage', { used: usage.used, unit: usage.unitLabel }) : t('mobileParity.billing.limitedUsage', { used: usage.used, limit: usage.limit, unit: usage.unitLabel, percent: percent?.toFixed(0) });
  return (
    <View accessible accessibilityLabel={t('mobileParity.billing.usageA11y', { label: usage.label, usage: label })} style={styles.usageRow}>
      <View style={styles.usageHeading}>
        <Text style={[typography.callout, { color: theme.colors.text }]}>{usage.label}</Text>
        <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{usage.limit === null ? t('mobileParity.billing.currentUsage', { used: usage.used }) : t('mobileParity.billing.currentUsageLimited', { used: usage.used, limit: usage.limit, unit: usage.unitLabel })}</Text>
      </View>
      <View style={[styles.usageTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
        <View style={[styles.usageFill, { width: `${percent ?? 100}%`, backgroundColor: percent !== null && percent >= 90 ? theme.colors.accent : theme.colors.primary }]} />
      </View>
    </View>
  );
}

function PlanRow({ plan, model, actions, platform, isLast }: { plan: BillingPlanItem; model: BillingViewModel; actions: BillingActions; platform: AdaptivePlatform; isLast: boolean }) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const disabled = model.offline || model.actionBusy || !model.canManageBilling || plan.current;
  const priceLabel = `${new Intl.NumberFormat(model.locale, { style: 'currency', currency: plan.currency }).format(plan.amount)} ${t(plan.interval === 'month' ? 'mobileParity.billing.perMonth' : 'mobileParity.billing.perYear')}`;
  return (
    <View style={[styles.planRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }]}>
      <View
        accessible
        accessibilityLabel={`${plan.name}, ${priceLabel}, ${plan.description}, ${plan.features.join(', ')}${plan.current ? t('mobileParity.billing.currentPlanA11y') : ''}${plan.recommended ? t('mobileParity.billing.recommendedA11y') : ''}`}
        style={styles.planHeading}
      >
        <View style={styles.planTitleWrap}>
          <Text style={[typography.section, { color: theme.colors.text }]}>{plan.name}</Text>
          {plan.current ? <View style={[styles.badge, { backgroundColor: theme.colors.primaryContainer }]}><Text style={[typography.caption, { color: theme.colors.primary }]}>{t('mobileParity.billing.current')}</Text></View> : null}
          {plan.recommended ? <View style={[styles.badge, { backgroundColor: theme.colors.accentContainer }]}><Text style={[typography.caption, { color: theme.colors.accent }]}>{t('mobileParity.billing.recommended')}</Text></View> : null}
        </View>
        <Text style={[typography.headline, { color: theme.colors.text }]}>{priceLabel}</Text>
      </View>
      <Text style={[typography.body, { color: theme.colors.textMuted }]}>{plan.description}</Text>
      <View style={styles.features}>
        {plan.features.map((feature) => <View key={feature} style={styles.featureRow}><Check size={17} color={theme.colors.success} /><Text style={[typography.callout, styles.featureCopy, { color: theme.colors.textSecondary }]}>{feature}</Text></View>)}
      </View>
      {!plan.current ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mobileParity.billing.choose', { name: plan.name })}
          accessibilityState={{ disabled: Boolean(disabled), busy: model.actionBusy }}
          disabled={Boolean(disabled)}
          onPress={() => actions.onSelectPlan(plan.id)}
          style={({ pressed }) => [styles.chooseButton, { minHeight: theme.minimumHitSize, borderColor: theme.colors.primary, backgroundColor: plan.recommended ? theme.colors.primary : 'transparent', opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}
        >
          <Text style={[typography.headline, { color: plan.recommended ? theme.colors.onPrimary : theme.colors.primary }]}>{t('mobileParity.billing.choose', { name: plan.name })}</Text>
          <ChevronRight size={19} color={plan.recommended ? theme.colors.onPrimary : theme.colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function BillingScreen({ model, actions, platform = Platform.OS === 'ios' ? 'ios' : 'android' }: BillingScreenProps) {
  const { t } = useTranslation();
  const theme = useAdaptiveTheme(platform);
  const layout = useAdaptiveLayout();
  if (model.status === 'loading') return <StatusPanel platform={platform} title={t('mobileParity.billing.loadingPlan')} body={t('mobileParity.billing.loadingBody')} loading />;
  if (model.status === 'error') return <StatusPanel platform={platform} title={t('mobileParity.billing.unavailableTitle')} body={model.errorMessage ?? t('mobileParity.billing.planUnavailable')} onRetry={actions.onRetry} />;
  if (model.status === 'permission-denied') return <StatusPanel platform={platform} title={t('mobileParity.billing.restrictedTitle')} body={model.permissionMessage ?? t('mobileParity.billing.ownerOnly')} />;

  const selfHosted = model.deploymentMode === 'self_hosted';
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={Boolean(model.refreshing)} onRefresh={actions.onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
        contentContainerStyle={[styles.content, { paddingHorizontal: layout.horizontalPadding, maxWidth: theme.contentMaxWidth }]}
      >
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[typography.title, { color: theme.colors.text }]}>{selfHosted ? t('mobileParity.billing.titleSelfHosted') : t('mobileParity.billing.titleCloud')}</Text>
          <Text style={[typography.body, { color: theme.colors.textMuted }]}>{selfHosted ? t('mobileParity.billing.subtitleSelfHosted') : t('mobileParity.billing.subtitleCloud')}</Text>
        </View>

        {selfHosted ? (
          <AdaptiveSurface accessibilityLabel={t('mobileParity.billing.selfHostedA11y')} style={styles.selfHosted}>
            <View style={[styles.unlimitedIcon, { backgroundColor: theme.colors.primaryContainer }]}><InfinityIcon size={34} color={theme.colors.primary} /></View>
            <View style={styles.selfHostedCopy}>
              <View style={styles.titleWithIcon}><Server size={20} color={theme.colors.primary} /><Text style={[typography.section, { color: theme.colors.text }]}>{t('mobileParity.billing.unlimitedSelfHosted')}</Text></View>
              <Text style={[typography.body, { color: theme.colors.textMuted }]}>{t('mobileParity.billing.selfHostedBody')}</Text>
            </View>
          </AdaptiveSurface>
        ) : (
          <>
            {model.subscription.state === 'trialing' ? (
              <View accessible accessibilityLabel={t('mobileParity.billing.trialA11y', { count: model.subscription.trialDaysRemaining ?? 0, date: model.subscription.trialEndsLabel })} style={[styles.trial, { backgroundColor: theme.colors.primaryContainer }]}>
                <Sparkles size={22} color={theme.colors.primary} />
                <View style={styles.trialCopy}>
                  <Text style={[typography.headline, { color: theme.colors.primary }]}>{t('mobileParity.billing.trialRemaining', { count: model.subscription.trialDaysRemaining ?? 0 })}</Text>
                  <Text style={[typography.caption, { color: theme.colors.textSecondary }]}>{t('mobileParity.billing.ends', { date: model.subscription.trialEndsLabel })}</Text>
                </View>
              </View>
            ) : null}

            <AdaptiveSurface style={styles.subscription}>
              <View style={[styles.crownIcon, { backgroundColor: model.subscription.state === 'past_due' ? theme.colors.accentContainer : theme.colors.primaryContainer }]}><Crown size={25} color={model.subscription.state === 'past_due' ? theme.colors.accent : theme.colors.primary} /></View>
              <View
                accessible
                accessibilityLabel={`${localizedSubscriptionState(t, model.subscription.state)} · ${model.subscription.planName}${model.subscription.renewalLabel ? ` · ${model.subscription.renewalLabel}` : ''}${model.subscription.cancelAtLabel ? ` · ${model.subscription.cancelAtLabel}` : ''}`}
                style={styles.subscriptionCopy}
              >
                <View style={styles.titleWithIcon}><Text style={[typography.section, { color: theme.colors.text }]}>{model.subscription.planName}</Text><View style={[styles.badge, { backgroundColor: model.subscription.state === 'past_due' ? theme.colors.accentContainer : theme.colors.surfaceMuted }]}><Text style={[typography.caption, { color: model.subscription.state === 'past_due' ? theme.colors.accent : theme.colors.textSecondary }]}>{localizedSubscriptionState(t, model.subscription.state)}</Text></View></View>
                <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{model.subscription.renewalLabel ?? model.subscription.cancelAtLabel ?? t('mobileParity.billing.noRenewal')}</Text>
              </View>
              {allowsExternalPurchases(platform) && model.canManageBilling && model.canOpenPortal ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('mobileParity.billing.openPortalA11y')}
                  accessibilityState={{ disabled: model.offline || model.actionBusy, busy: model.actionBusy }}
                  disabled={model.offline || model.actionBusy}
                  onPress={actions.onOpenPortal}
                  style={({ pressed }) => [styles.portalButton, { minHeight: theme.minimumHitSize, opacity: model.offline || model.actionBusy ? 0.4 : pressed ? 0.55 : 1 }]}
                ><ExternalLink size={18} color={theme.colors.primary} /><Text style={[typography.callout, { color: theme.colors.primary }]}>{t('mobileParity.billing.manage')}</Text></Pressable>
              ) : null}
            </AdaptiveSurface>
          </>
        )}

        <SectionHeader platform={platform} title={t('mobileParity.billing.usage')} />
        {model.usage.length ? <AdaptiveSurface style={styles.usageSurface}>{model.usage.map((usage) => <UsageRow key={usage.id} usage={usage} platform={platform} />)}</AdaptiveSurface> : <AdaptiveSurface style={styles.empty}><Text accessibilityRole="header" style={[typography.headline, { color: theme.colors.text }]}>{t('mobileParity.billing.noUsage')}</Text><Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{t('mobileParity.billing.noUsageBody')}</Text></AdaptiveSurface>}

        {!selfHosted && allowsExternalPurchases(platform) ? (
          <>
            <SectionHeader platform={platform} title={t('mobileParity.billing.availablePlans')} />
            {model.plans.length ? <AdaptiveSurface>{model.plans.map((plan, index) => <PlanRow key={plan.id} plan={plan} model={model} actions={actions} platform={platform} isLast={index === model.plans.length - 1} />)}</AdaptiveSurface> : <AdaptiveSurface style={styles.empty}><Text accessibilityRole="header" style={[typography.headline, { color: theme.colors.text }]}>{t('mobileParity.billing.plansUnavailable')}</Text><Text style={[typography.body, styles.centered, { color: theme.colors.textMuted }]}>{t('mobileParity.billing.plansUnavailableBody')}</Text></AdaptiveSurface>}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  state: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centered: { textAlign: 'center', maxWidth: 460 },
  retry: { marginTop: 8, borderRadius: 14, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', alignSelf: 'center', paddingTop: 20, paddingBottom: 52, gap: 14 },
  heading: { gap: 3 },
  offline: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  selfHosted: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  unlimitedIcon: { width: 62, height: 62, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  selfHostedCopy: { minWidth: 0, flex: 1, gap: 5 },
  titleWithIcon: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  trial: { borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  trialCopy: { minWidth: 0, flex: 1, gap: 2 },
  subscription: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  crownIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  subscriptionCopy: { minWidth: 0, flex: 1, gap: 3 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  portalButton: { paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', gap: 2 },
  usageSurface: { padding: 16, gap: 17 },
  usageRow: { gap: 7 },
  usageHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  usageTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  usageFill: { height: '100%', borderRadius: 999 },
  planRow: { padding: 18, gap: 10 },
  planHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  planTitleWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  features: { gap: 7 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureCopy: { minWidth: 0, flex: 1 },
  chooseButton: { alignSelf: 'stretch', borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  empty: { padding: 26, alignItems: 'center', gap: 7 },
});
