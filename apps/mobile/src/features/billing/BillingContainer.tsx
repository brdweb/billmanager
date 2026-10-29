import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import React, { useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useMobileRuntime } from '../../context/MobileRuntimeContext';
import { useServerProfiles } from '../../context/ServerProfileContext';
import { formatDate, getFormattingConfig } from '../../i18n/format';
import type { ApiResponse, BillingUsage, SubscriptionStatus } from '../../types';
import BillingScreen from './BillingScreen';
import type { SubscriptionState } from './models';
import { proPlans } from './pricing';
import { allowsExternalPurchases, runBillingAction } from './actions';
import { useTranslation } from 'react-i18next';

export default function BillingContainer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { activeProfile } = useServerProfiles();
  const runtime = useMobileRuntime();
  const formatting = getFormattingConfig();
  const selfHosted = activeProfile.deploymentMode !== 'saas' || !activeProfile.capabilities?.billing;
  const authScope = api.captureAuthSessionScope();
  const requestedScope = { ...authScope, serverProfileId: activeProfile.id, principalId: user ? String(user.id) : undefined, databaseId: authScope.databaseId ?? '' };
  const query = useQuery({
    queryKey: ['billing', activeProfile.id, user?.id],
    enabled: !selfHosted && runtime.online && Boolean(user),
    queryFn: async () => {
      const [status, usage] = await Promise.all([
        api.requestScopedGet<ApiResponse<SubscriptionStatus>>('/billing/status', requestedScope),
        api.requestScopedGet<ApiResponse<BillingUsage>>('/billing/usage', requestedScope),
      ]);
      if (!status.success || !usage.success) throw new Error(status.error ?? usage.error ?? t('mobileParity.billing.unavailableBody'));
      return { status: status.data!, usage: usage.data! };
    },
  });
  const subscription = query.data?.status;
  const tier = subscription?.effective_tier ?? 'free';
  const state: SubscriptionState = selfHosted
    ? 'unlimited'
    : subscription?.is_trialing
      ? 'trialing'
      : subscription?.status ?? (subscription?.has_subscription ? 'active' : 'free');
  const actionGate = useRef(false);
  const [actionBusy, setActionBusy] = useState(false);
  const purchasesAllowed = allowsExternalPurchases(Platform.OS);
  const plans = proPlans(t, tier, subscription?.billing_interval);

  const runAction = (request: () => ReturnType<typeof api.createPortalSession>, failureKey: string) => runBillingAction({
    gate: actionGate,
    allowed: purchasesAllowed && Boolean(user?.is_account_owner) && runtime.online && !selfHosted,
    isCurrent: () => api.isPrincipalScopeAuthenticated(requestedScope),
    request,
    openUrl: Linking.openURL,
    onBusy: setActionBusy,
    onError: (message) => Alert.alert(t('mobileParity.billing.unavailableTitle'), message ?? t(failureKey)),
  });
  const openCheckout = (planId: string) => {
    if (!/^pro-(month|year)$/.test(planId)) return;
    const interval = planId.endsWith('-month') ? 'monthly' : 'annual';
    return runAction(() => api.createCheckoutSession('pro', interval, requestedScope), 'mobileParity.billing.checkoutFailed');
  };
  const openPortal = () => runAction(() => api.createPortalSession(requestedScope), 'mobileParity.billing.portalFailed');

  return (
    <BillingScreen
      model={{
        status: selfHosted ? 'ready' : !runtime.online ? 'error' : query.isLoading ? 'loading' : query.error ? 'error' : 'ready',
        errorMessage: !runtime.online
          ? t('mobileParity.billing.connectFresh')
          : query.error instanceof Error ? query.error.message : undefined,
        offline: !runtime.online,
        lastUpdatedLabel: runtime.lastSyncedAt ? formatDate(runtime.lastSyncedAt) : undefined,
        deploymentMode: selfHosted ? 'self_hosted' : 'saas',
        locale: formatting.locale,
        currency: formatting.currency,
        subscription: {
          state,
          planName: selfHosted ? t('mobileParity.billing.selfHostedUnlimited') : tier !== 'free' ? t('billingPage.proPlan') : t('billingPage.tierFree'),
          renewalLabel: subscription?.current_period_end ? t('mobileParity.billing.renews', { date: formatDate(subscription.current_period_end) }) : undefined,
          cancelAtLabel: subscription?.cancel_at_period_end && subscription.current_period_end ? t('mobileParity.billing.cancels', { date: formatDate(subscription.current_period_end) }) : undefined,
          trialDaysRemaining: subscription?.trial_days_remaining,
        },
        usage: selfHosted ? [
          { id: 'bills', label: t('billingPage.billsLabel'), used: runtime.bills.length, limit: null, unitLabel: t('mobileParity.billing.billsUnit') },
          { id: 'groups', label: t('billingPage.billGroupsLabel'), used: runtime.groups.length, limit: null, unitLabel: t('mobileParity.billing.groupsUnit') },
        ] : Object.entries(query.data?.usage.usage ?? {}).map(([id, value]) => ({
          id,
          label: id.replace('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase()),
          used: value.used,
          limit: value.unlimited ? null : value.limit,
          unitLabel: id.replace('_', ' '),
        })),
        plans: selfHosted || !purchasesAllowed ? [] : plans,
        canManageBilling: purchasesAllowed && Boolean(user?.is_account_owner),
        actionBusy,
        refreshing: query.isFetching,
      }}
      actions={{
        onSelectPlan: (id) => void openCheckout(id),
        onOpenPortal: () => void openPortal(),
        onRefresh: () => void query.refetch(),
        onRetry: () => void query.refetch(),
      }}
    />
  );
}
