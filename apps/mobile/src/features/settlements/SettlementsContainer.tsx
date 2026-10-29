import { useQuery } from '@tanstack/react-query';
import React, { useRef } from 'react';
import { Alert } from 'react-native';
import { randomUUID } from 'expo-crypto';

import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useMobileRuntime } from '../../context/MobileRuntimeContext';
import { useServerProfiles } from '../../context/ServerProfileContext';
import { MobileCacheRepository } from '../../data/cacheRepository';
import { formatDate, getFormattingConfig } from '../../i18n/format';
import type { ApiResponse, SettlementsResponse } from '../../types';
import SettlementsScreen from './SettlementsScreen';
import { SettlementAttemptLedger, hasSettlementPreconditions } from './attemptLedger';
import { settleOutstandingShares } from './actions';
import { useActionScope } from '../useActionScope';
import { useTranslation } from 'react-i18next';

const cacheRepository = new MobileCacheRepository();
const snapshotKey = 'settlements-v1';

export default function SettlementsContainer() {
  const { t } = useTranslation();
  const { user, currentDatabase, databases } = useAuth();
  const { activeProfile, verifyActiveProfile } = useServerProfiles();
  const runtime = useMobileRuntime();
  const formatting = getFormattingConfig();
  const supported = activeProfile.capabilities?.settlements ?? false;
  const scope = { serverProfileId: activeProfile.id, principalId: user ? String(user.id) : undefined, databaseId: currentDatabase ?? '' };
  const safePayments = activeProfile.capabilities?.settlementPaymentPreconditions === true;
  const actionScope = useActionScope(JSON.stringify([scope, safePayments]));
  const attempts = useRef(new SettlementAttemptLedger());
  const scopeKey = JSON.stringify(scope);
  const lastServerRead = useRef<{ scope: string; revision: number; snapshot: SettlementsResponse } | null>(null);
  const requestedScope = { ...api.captureAuthSessionScope(), ...scope };
  const isActionCurrent = () => {
    const active = api.captureAuthSessionScope();
    return actionScope.isActive() && active.serverProfileId === requestedScope.serverProfileId
      && active.principalId === requestedScope.principalId
      && active.databaseId === requestedScope.databaseId;
  };
  const query = useQuery({
    queryKey: ['settlements', activeProfile.id, user?.id, currentDatabase, runtime.online],
    enabled: supported && Boolean(currentDatabase) && Boolean(user),
    queryFn: async () => {
      if (!runtime.online) {
        const saved = await cacheRepository.getAnalyticsSnapshot<SettlementsResponse>(scope, snapshotKey);
        if (!saved) throw new Error(t('mobileParity.settlements.noSavedData'));
        return saved;
      }
      const readRevision = attempts.current.revision;
      const startedIdle = !actionScope.gate.current;
      const response = await api.requestScopedGet<ApiResponse<SettlementsResponse>>('/settlements', scope);
      if (!response.success || !response.data) throw new Error(response.error ?? t('mobileParity.settlements.unavailableBody'));
      await cacheRepository.putAnalyticsSnapshot(scope, snapshotKey, response.data, null);
      lastServerRead.current = { scope: scopeKey, revision: readRevision, snapshot: response.data };
      if (startedIdle && !actionScope.gate.current && isActionCurrent()) {
        attempts.current.reconcile(scopeKey, response.data, readRevision);
      }
      return response.data;
    },
  });
  const refreshPaymentState = async () => {
    if (!isActionCurrent()) return;
    try {
      if (!safePayments) await verifyActiveProfile();
      // Verification can replace capabilities or the active profile; never
      // continue an old screen's work after that scope lease expires.
      if (!isActionCurrent()) return;
      await query.refetch();
    } catch {
      if (isActionCurrent()) Alert.alert(t('mobileParity.settlements.unavailableTitle'), t('mobileParity.settlements.unavailableBody'));
    }
  };
  const data = query.data;
  const bucketLabel = currentDatabase === '_all_'
    ? t('mobileCore.common.allBuckets')
    : databases.find((database) => database.name === currentDatabase)?.display_name ?? t('mobileParity.analytics.currentBucket');

  return (
    <SettlementsScreen
      model={{
        status: !supported ? 'permission-denied' : query.isLoading ? 'loading' : query.error ? 'error' : 'ready',
        permissionMessage: !supported ? t('mobileParity.settlements.supportRequired') : undefined,
        errorMessage: query.error instanceof Error ? query.error.message : undefined,
        offline: !runtime.online,
        lastUpdatedLabel: runtime.lastSyncedAt ? formatDate(runtime.lastSyncedAt) : undefined,
        locale: formatting.locale,
        currency: formatting.currency,
        bucketLabel,
        summary: {
          owedToYou: data?.summary.owed_to_me ?? 0,
          youOwe: data?.summary.i_owe ?? 0,
          net: data?.summary.net_balance ?? 0,
          outstandingPeople: data?.people.filter((person) => person.open_count > 0).length ?? 0,
        },
        people: (data?.people ?? []).map((person) => ({
          userId: person.counterparty_name,
          displayName: person.counterparty_name,
          balance: Math.abs(person.net),
          direction: person.net > 0 ? 'owes-you' : person.net < 0 ? 'you-owe' : 'settled',
          canMarkPaid: Boolean(data?.i_owe.some((item) => item.counterparty_name === person.counterparty_name)),
          sharedBillCount: person.open_count,
          lastActivityLabel: t('mobileParity.settlements.openSharedBills'),
        })),
        recentHistory: (data?.settled ?? []).map((item) => ({
          id: String(item.share_id),
          payerName: item.direction === 'i_owe' ? t('mobileParity.collaboration.you') : item.counterparty_name,
          payeeName: item.direction === 'i_owe' ? item.counterparty_name : t('mobileParity.collaboration.you'),
          amount: item.amount,
          settledAt: item.paid_date ?? item.due_date,
          settledAtLabel: formatDate(item.paid_date ?? item.due_date),
        })),
        refreshing: query.isFetching,
        actionBusy: actionScope.busy || query.isFetching,
      }}
      actions={{
        onOpenPerson: (name) => {
          if (!isActionCurrent()) return;
          const bills = [...(data?.owed_to_me ?? []), ...(data?.i_owe ?? [])].filter((item) => item.counterparty_name === name);
          Alert.alert(name, bills.length > 0 ? bills.map((item) => `${item.bill_name}: ${new Intl.NumberFormat(formatting.locale, { style: 'currency', currency: formatting.currency }).format(item.amount)}`).join('\n') : t('mobileParity.settlements.noOpenBills'));
        },
        onMarkPaid: (name) => {
          if (!isActionCurrent() || actionScope.gate.current || !runtime.online || query.isFetching) return;
          const items = (data?.i_owe ?? []).filter((candidate) => candidate.counterparty_name === name && !attempts.current.isConfirmed(scopeKey, candidate));
          if (items.length === 0) return;
          if (!safePayments
            || items.some((item) => !hasSettlementPreconditions(item) || attempts.current.isConflicted(scopeKey, item))) {
            Alert.alert(t('mobileParity.settlements.refreshRequiredTitle'),
              t(!safePayments
                ? 'mobileParity.settlements.serverUpdateRequired' : 'mobileParity.settlements.changedRefreshRequired'),
              [{ text: t('mobileParity.common.cancel'), style: 'cancel' },
                { text: t('mobileParity.settlements.refreshAction'), onPress: () => { void refreshPaymentState(); } }]);
            return;
          }
          attempts.current.beginAction();
          actionScope.setBusy(true);
          let confirmedOnce = false;
          const finish = () => actionScope.setBusy(false);
          const total = items.reduce((sum, item) => sum + item.amount, 0);
          Alert.alert(t('mobileParity.settlements.settleTitle'), t('mobileParity.settlements.settleBody', { count: items.length, amount: new Intl.NumberFormat(formatting.locale, { style: 'currency', currency: formatting.currency }).format(total) }), [
            { text: t('mobileParity.common.cancel'), style: 'cancel', onPress: () => { confirmedOnce = true; finish(); } },
            {
              text: t('settlementsPage.markPaidButton'),
              onPress: () => {
                if (confirmedOnce || !isActionCurrent()) return;
                confirmedOnce = true;
                void (async () => {
                  try {
                    const result = await settleOutstandingShares(items.map((item) => item.share_id), new Set<number>(),
                      (id) => {
                        const item = items.find((item) => item.share_id === id)!;
                        const intent = attempts.current.intent(scopeKey, item, randomUUID);
                        if (!intent) return Promise.resolve({ success: false });
                        return api.markSharePaid(id, requestedScope, intent.mutationId, {
                          baseUpdatedAt: intent.baseUpdatedAt, baseBillUpdatedAt: intent.baseBillUpdatedAt, expectedDueDate: intent.expectedDueDate,
                        });
                      }, () => api.isPrincipalScopeAuthenticated(requestedScope), isActionCurrent);
                    for (const item of items) if (result.succeeded.includes(item.share_id)) attempts.current.confirm(scopeKey, item);
                    for (const item of items) if (result.conflicted?.includes(item.share_id)) attempts.current.conflict(scopeKey, item);
                    attempts.current.finishDispatches();
                    if (!await api.isPrincipalScopeAuthenticated(requestedScope) || !isActionCurrent()) return;
                    if (result.failed.length) Alert.alert(
                      t(result.conflicted?.length ? 'mobileParity.settlements.refreshRequiredTitle' : 'settlementsPage.markPaidFailedTitle'),
                      `${t('settlementsPage.markPaidSuccess')}: ${result.succeeded.length}/${items.length}\n${t(result.conflicted?.length ? 'mobileParity.settlements.changedRefreshRequired' : 'settlementsPage.markPaidFailedBody')}\n${items.filter((item) => result.failed.includes(item.share_id)).map((item) => item.bill_name).join('\n')}`);
                    const previousRead = lastServerRead.current;
                    const revision = attempts.current.revision;
                    await query.refetch({ cancelRefetch: true });
                    const fresh = lastServerRead.current;
                    if (fresh && fresh !== previousRead && fresh.scope === scopeKey
                      && fresh.revision === revision && isActionCurrent()) {
                      // Only a real server read started after these completed
                      // mutations is authoritative. Offline cache/refetch state
                      // and late pre-mutation requests cannot retire retry IDs.
                      attempts.current.reconcile(scopeKey, fresh.snapshot, revision);
                    }
                  } catch {
                    if (await api.isPrincipalScopeAuthenticated(requestedScope) && isActionCurrent()) Alert.alert(t('settlementsPage.markPaidFailedTitle'), t('settlementsPage.markPaidFailedBody'));
                  } finally { finish(); }
                })();
              },
            },
          ], { cancelable: false });
        },
        onOpenHistory: () => { if (isActionCurrent()) Alert.alert(t('mobileParity.settlements.historyTitle'), t('mobileParity.settlements.historyBody', { count: data?.settled.length ?? 0 })); },
        onRefresh: () => { void refreshPaymentState(); },
        onRetry: () => { void refreshPaymentState(); },
      }}
    />
  );
}
