import { useQuery } from '@tanstack/react-query';
import React, { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { randomUUID } from 'expo-crypto';

import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useMobileRuntime } from '../../context/MobileRuntimeContext';
import { useServerProfiles } from '../../context/ServerProfileContext';
import { MobileCacheRepository } from '../../data/cacheRepository';
import { formatDate, getFormattingConfig } from '../../i18n/format';
import type { SettlementsResponse } from '../../types';
import SettlementsScreen from './SettlementsScreen';
import { settleOutstandingShares } from './actions';
import { useTranslation } from 'react-i18next';

const cacheRepository = new MobileCacheRepository();
const snapshotKey = 'settlements-v1';

export default function SettlementsContainer() {
  const { t } = useTranslation();
  const { user, currentDatabase, databases } = useAuth();
  const { activeProfile } = useServerProfiles();
  const runtime = useMobileRuntime();
  const formatting = getFormattingConfig();
  const supported = activeProfile.capabilities?.settlements ?? false;
  const scope = { serverProfileId: activeProfile.id, principalId: user ? String(user.id) : undefined, databaseId: currentDatabase ?? '' };
  const pending = useRef(false);
  const [actionBusy, setActionBusy] = useState(false);
  const confirmations = useRef(new Set<string>());
  const mutationIds = useRef(new Map<string, string>());
  const query = useQuery({
    queryKey: ['settlements', activeProfile.id, user?.id, currentDatabase, runtime.online],
    enabled: supported && Boolean(currentDatabase) && Boolean(user),
    queryFn: async () => {
      if (!runtime.online) {
        const saved = await cacheRepository.getAnalyticsSnapshot<SettlementsResponse>(scope, snapshotKey);
        if (!saved) throw new Error(t('mobileParity.settlements.noSavedData'));
        return saved;
      }
      const response = await api.getSettlements();
      if (!response.success || !response.data) throw new Error(response.error ?? t('mobileParity.settlements.unavailableBody'));
      await cacheRepository.putAnalyticsSnapshot(scope, snapshotKey, response.data, null);
      return response.data;
    },
  });
  const data = query.data;
  const requestedScope = api.captureAuthSessionScope();
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
        actionBusy: actionBusy || query.isFetching,
      }}
      actions={{
        onOpenPerson: (name) => {
          const bills = [...(data?.owed_to_me ?? []), ...(data?.i_owe ?? [])].filter((item) => item.counterparty_name === name);
          Alert.alert(name, bills.length > 0 ? bills.map((item) => `${item.bill_name}: ${new Intl.NumberFormat(formatting.locale, { style: 'currency', currency: formatting.currency }).format(item.amount)}`).join('\n') : t('mobileParity.settlements.noOpenBills'));
        },
        onMarkPaid: (name) => {
          if (pending.current || !runtime.online || query.isFetching) return;
          const itemKey = (item: NonNullable<typeof data>['i_owe'][number]) => JSON.stringify([scope, item.share_id, item.due_date]);
          const items = (data?.i_owe ?? []).filter((candidate) => candidate.counterparty_name === name && !confirmations.current.has(itemKey(candidate)));
          if (items.length === 0) return;
          pending.current = true;
          setActionBusy(true);
          const finish = () => { pending.current = false; setActionBusy(false); };
          const total = items.reduce((sum, item) => sum + item.amount, 0);
          Alert.alert(t('mobileParity.settlements.settleTitle'), t('mobileParity.settlements.settleBody', { count: items.length, amount: new Intl.NumberFormat(formatting.locale, { style: 'currency', currency: formatting.currency }).format(total) }), [
            { text: t('mobileParity.common.cancel'), style: 'cancel', onPress: finish },
            {
              text: t('settlementsPage.markPaidButton'),
              onPress: () => void (async () => {
                try {
                  const result = await settleOutstandingShares(items.map((item) => item.share_id), new Set<number>(),
                    (id) => {
                      const key = itemKey(items.find((item) => item.share_id === id)!);
                      const mutationId = mutationIds.current.get(key) ?? randomUUID();
                      mutationIds.current.set(key, mutationId);
                      return api.markSharePaid(id, requestedScope, mutationId);
                    }, () => api.isPrincipalScopeAuthenticated(requestedScope));
                  for (const item of items) if (result.succeeded.includes(item.share_id)) confirmations.current.add(itemKey(item));
                  if (!await api.isPrincipalScopeAuthenticated(requestedScope)) return;
                  if (result.failed.length) Alert.alert(t('settlementsPage.markPaidFailedTitle'),
                    `${t('settlementsPage.markPaidSuccess')}: ${result.succeeded.length}/${items.length}\n${t('settlementsPage.markPaidFailedBody')}\n${items.filter((item) => result.failed.includes(item.share_id)).map((item) => item.bill_name).join('\n')}`);
                  await query.refetch();
                } catch {
                  if (await api.isPrincipalScopeAuthenticated(requestedScope)) Alert.alert(t('settlementsPage.markPaidFailedTitle'), t('settlementsPage.markPaidFailedBody'));
                } finally { finish(); }
              })(),
            },
          ], { cancelable: false });
        },
        onOpenHistory: () => Alert.alert(t('mobileParity.settlements.historyTitle'), t('mobileParity.settlements.historyBody', { count: data?.settled.length ?? 0 })),
        onRefresh: () => void query.refetch(),
        onRetry: () => void query.refetch(),
      }}
    />
  );
}
