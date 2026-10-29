import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { Alert } from 'react-native';

import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useMobileRuntime } from '../../context/MobileRuntimeContext';
import { useServerProfiles } from '../../context/ServerProfileContext';
import { MobileCacheRepository } from '../../data/cacheRepository';
import { formatDate, getFormattingConfig } from '../../i18n/format';
import type { ApiResponse, SettlementsResponse } from '../../types';
import SettlementsScreen from './SettlementsScreen';
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
  const scope = { serverProfileId: activeProfile.id, databaseId: currentDatabase ?? '', principalId: user ? String(user.id) : undefined };
  const query = useQuery({
    queryKey: ['settlements', activeProfile.id, currentDatabase, runtime.online],
    enabled: supported && Boolean(currentDatabase),
    queryFn: async () => {
      if (!runtime.online) {
        const saved = await cacheRepository.getAnalyticsSnapshot<SettlementsResponse>(scope, snapshotKey);
        if (!saved) throw new Error(t('mobileParity.settlements.noSavedData'));
        return saved;
      }
      const response = await api.requestScopedGet<ApiResponse<SettlementsResponse>>('/settlements', scope);
      if (!response.success || !response.data) throw new Error(response.error ?? t('mobileParity.settlements.unavailableBody'));
      await cacheRepository.putAnalyticsSnapshot(scope, snapshotKey, response.data, null);
      return response.data;
    },
  });
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
      }}
      actions={{
        onOpenPerson: (name) => {
          const bills = [...(data?.owed_to_me ?? []), ...(data?.i_owe ?? [])].filter((item) => item.counterparty_name === name);
          Alert.alert(name, bills.length > 0 ? bills.map((item) => `${item.bill_name}: ${new Intl.NumberFormat(formatting.locale, { style: 'currency', currency: formatting.currency }).format(item.amount)}`).join('\n') : t('mobileParity.settlements.noOpenBills'));
        },
        onMarkPaid: (name) => {
          const items = (data?.i_owe ?? []).filter((candidate) => candidate.counterparty_name === name);
          if (items.length === 0) return;
          const total = items.reduce((sum, item) => sum + item.amount, 0);
          Alert.alert(t('mobileParity.settlements.settleTitle'), t('mobileParity.settlements.settleBody', { count: items.length, amount: new Intl.NumberFormat(formatting.locale, { style: 'currency', currency: formatting.currency }).format(total) }), [
            { text: t('mobileParity.common.cancel'), style: 'cancel' },
            {
              text: t('settlementsPage.markPaidButton'),
              onPress: () => void Promise.all(items.map((item) => api.markSharePaid(item.share_id))).then(() => query.refetch()),
            },
          ]);
        },
        onOpenHistory: () => Alert.alert(t('mobileParity.settlements.historyTitle'), t('mobileParity.settlements.historyBody', { count: data?.settled.length ?? 0 })),
        onRefresh: () => void query.refetch(),
        onRetry: () => void query.refetch(),
      }}
    />
  );
}
