import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { Alert } from 'react-native';

import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useMobileRuntime } from '../../context/MobileRuntimeContext';
import { useServerProfiles } from '../../context/ServerProfileContext';
import { MobileCacheRepository } from '../../data/cacheRepository';
import { formatDate, getFormattingConfig } from '../../i18n/format';
import type { ApiResponse, Bill, BillShare, PendingShare, SharedBill } from '../../types';
import CollaborationScreen from './CollaborationScreen';
import type { ShareInviteItem, SharedBillItem, ShareSplitMode } from './models';
import { useTranslation } from 'react-i18next';

interface CollaborationSnapshot {
  received: SharedBill[];
  pending: PendingShare[];
  owned: Array<{ bill: Bill; shares: BillShare[] }>;
}

const cacheRepository = new MobileCacheRepository();
const snapshotKey = 'collaboration-v1';

function splitMode(value: string | null): ShareSplitMode {
  return value === 'percentage' || value === 'fixed' ? value : 'equal';
}

export default function CollaborationContainer() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user, currentDatabase, databases } = useAuth();
  const { activeProfile } = useServerProfiles();
  const runtime = useMobileRuntime();
  const formatting = getFormattingConfig();
  const supported = activeProfile.capabilities?.sharing ?? false;
  const scope = { serverProfileId: activeProfile.id, databaseId: currentDatabase ?? '', principalId: user ? String(user.id) : undefined };
  const query = useQuery({
    queryKey: ['collaboration', activeProfile.id, currentDatabase, runtime.online, runtime.bills.map((bill) => `${bill.id}:${bill.share_count ?? 0}`).join(',')],
    enabled: supported && Boolean(currentDatabase),
    queryFn: async () => {
      if (!runtime.online) {
        const saved = await cacheRepository.getAnalyticsSnapshot<CollaborationSnapshot>(scope, snapshotKey);
        if (!saved) throw new Error(t('mobileParity.collaboration.noSavedData'));
        return saved;
      }

      const ownedBills = runtime.bills.filter((bill) => !bill.is_shared && (bill.share_count ?? 0) > 0);
      const [received, pending, owned] = await Promise.all([
        api.requestScopedGet<ApiResponse<SharedBill[]>>('/shared-bills', scope),
        api.requestScopedGet<ApiResponse<PendingShare[]>>('/shared-bills/pending', scope),
        Promise.all(ownedBills.map(async (bill) => {
          const response = await api.requestScopedGet<ApiResponse<BillShare[]>>(`/bills/${bill.id}/shares`, scope);
          if (!response.success) throw new Error(response.error ?? t('mobileParity.collaboration.sharesUnavailable', { name: bill.name }));
          return { bill, shares: response.data ?? [] };
        })),
      ]);
      if (!received.success || !pending.success) throw new Error(received.error ?? pending.error ?? t('mobileParity.collaboration.unavailableBody'));
      const snapshot: CollaborationSnapshot = { received: received.data ?? [], pending: pending.data ?? [], owned };
      await cacheRepository.putAnalyticsSnapshot(scope, snapshotKey, snapshot, null);
      return snapshot;
    },
  });
  const data = query.data ?? { received: [], pending: [], owned: [] };
  const sharedBills: SharedBillItem[] = [
    ...data.received.map((share) => ({
      shareId: String(share.share_id),
      billId: String(share.bill.id),
      billName: share.bill.name,
      ownerName: share.owner,
      totalAmount: share.bill.amount ?? 0,
      myShareAmount: share.my_portion ?? 0,
      splitMode: splitMode(share.split_type),
      participants: [{ userId: share.owner, displayName: share.owner, email: '', owner: true }],
      dueLabel: formatDate(share.bill.next_due),
      cadenceLabel: share.bill.frequency,
      canManage: false,
    })),
    ...data.owned.flatMap(({ bill, shares }) => shares
      .filter((share) => share.status === 'accepted')
      .map((share) => ({
        shareId: String(share.id),
        billId: String(bill.id),
        billName: bill.name,
        ownerName: t('mobileParity.collaboration.you'),
        totalAmount: bill.amount ?? bill.avg_amount ?? 0,
        myShareAmount: bill.amount ?? bill.avg_amount ?? 0,
        splitMode: splitMode(share.split_type),
        participants: [{ userId: share.shared_with, displayName: share.shared_with, email: '', owner: false }],
        dueLabel: formatDate(bill.next_due),
        cadenceLabel: bill.frequency,
        canManage: true,
      }))),
  ];
  const pendingInvites: ShareInviteItem[] = [
    ...data.pending.map((invite) => ({
      id: String(invite.share_id),
      direction: 'incoming' as const,
      billName: invite.bill_name,
      invitedByName: invite.owner,
      splitMode: splitMode(invite.split_type),
      shareAmount: invite.bill_amount ?? undefined,
      sharePercent: invite.split_type === 'percentage' ? invite.split_value ?? undefined : undefined,
      expiresLabel: t('mobileParity.collaboration.sent', { date: formatDate(invite.created_at) }),
    })),
    ...data.owned.flatMap(({ bill, shares }) => shares
      .filter((share) => share.status === 'pending')
      .map((share) => ({
        id: String(share.id),
        direction: 'outgoing' as const,
        billName: bill.name,
        invitedEmail: share.shared_with,
        splitMode: splitMode(share.split_type),
        shareAmount: share.split_type === 'fixed' ? share.split_value ?? undefined : undefined,
        sharePercent: share.split_type === 'percentage' ? share.split_value ?? undefined : undefined,
        expiresLabel: t('mobileParity.collaboration.sent', { date: formatDate(share.created_at) }),
      }))),
  ];
  const bucketLabel = currentDatabase === '_all_'
    ? t('mobileCore.common.allBuckets')
    : databases.find((database) => database.name === currentDatabase)?.display_name ?? t('mobileParity.analytics.currentBucket');

  return (
    <CollaborationScreen
      model={{
        status: !supported ? 'permission-denied' : query.isLoading ? 'loading' : query.error ? 'error' : 'ready',
        permissionMessage: !supported ? t('mobileParity.collaboration.supportRequired') : undefined,
        errorMessage: query.error instanceof Error ? query.error.message : undefined,
        offline: !runtime.online,
        lastUpdatedLabel: runtime.lastSyncedAt ? formatDate(runtime.lastSyncedAt) : undefined,
        locale: formatting.locale,
        currency: formatting.currency,
        bucketLabel,
        sharedBills,
        pendingInvites,
        refreshing: query.isFetching,
      }}
      actions={{
        onAddShare: () => navigation.navigate('SharedBills'),
        onOpenSharedBill: () => navigation.navigate('SharedBills'),
        onEditSplit: () => navigation.navigate('SharedBills'),
        onRevokeShare: (id) => Alert.alert(t('mobileParity.collaboration.revokeTitle'), t('mobileParity.collaboration.revokeBody'), [
          { text: t('mobileParity.common.cancel'), style: 'cancel' },
          { text: t('mobileParity.collaboration.revoke'), style: 'destructive', onPress: () => void api.revokeShare(Number(id)).then(() => query.refetch()) },
        ]),
        onAcceptInvite: (id) => void api.acceptShare(Number(id)).then(() => query.refetch()),
        onDeclineInvite: (id) => void api.declineShare(Number(id)).then(() => query.refetch()),
        onRevokeInvite: (id) => void api.revokeShare(Number(id)).then(() => query.refetch()),
        onRefresh: () => void query.refetch(),
        onRetry: () => void query.refetch(),
      }}
    />
  );
}
