import { useRef } from 'react';
import { Alert } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useServerProfiles } from '../../context/ServerProfileContext';
import type { ApiResponse, Bill } from '../../types';
import { useActionScope } from '../useActionScope';
import { hasSettlementPreconditions } from './attemptLedger';

/** Detail changes express a desired state, never a toggle. Unknown retries pin the original intent. */
export function useSharePaymentAction(
  billId: number,
  bill: Bill | null,
  online: boolean,
  sync: () => Promise<unknown>,
) {
  const { t } = useTranslation();
  const { user, currentDatabase } = useAuth();
  const { activeProfile, verifyActiveProfile } = useServerProfiles();
  const supported =
    activeProfile.capabilities?.settlementPaymentDesiredState === true;
  const scope = {
    ...api.captureAuthSessionScope(),
    serverProfileId: activeProfile.id,
    principalId: user ? String(user.id) : undefined,
    databaseId: currentDatabase ?? '',
  };
  const key = JSON.stringify([
    scope.serverProfileId,
    scope.principalId,
    scope.databaseId,
    billId,
    supported,
  ]);
  const lease = useActionScope(key);
  type Intent = {
    bill: Bill;
    mutationId: string;
    baseUpdatedAt: string;
    baseBillUpdatedAt: string;
    expectedDueDate: string;
    desiredPaid: boolean;
    blocked: boolean;
  };
  const state = useRef<{ key: string; intent?: Intent; fresh?: Bill }>({ key });
  if (state.current.key !== key) state.current = { key };
  const session = state.current;
  const current = () => {
    const active = api.captureAuthSessionScope();
    return (
      lease.isActive() &&
      active.serverProfileId === scope.serverProfileId &&
      active.principalId === scope.principalId &&
      active.databaseId === scope.databaseId
    );
  };
  // Keep the amount, occurrence and paid label the user acted on visible across uncertain retries.
  const displayedBill = session.intent?.bill ?? session.fresh ?? bill;
  const refresh = async () => {
    if (!current() || lease.gate.current || !online) return;
    lease.setBusy(true);
    try {
      if (!supported) {
        await verifyActiveProfile();
        return;
      }
      const result = await api.requestScopedGet<ApiResponse<Bill>>(
        `/bills/${billId}`,
        scope,
      );
      if (!current()) return;
      if (!result.success || !result.data || result.data.id !== billId)
        throw new Error(result.error);
      session.fresh = result.data;
      session.intent = undefined;
      await sync().catch(() => null);
    } catch {
      if (current())
        Alert.alert(
          t('mobileParity.common.error'),
          t('mobileParity.billDetail.refreshFailed'),
        );
    } finally {
      lease.setBusy(false);
    }
  };
  const requestRefresh = () =>
    Alert.alert(
      t('mobileParity.billDetail.reviewPayment'),
      t('mobileParity.billDetail.refreshPayment'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.refresh'),
          onPress: () => {
            void refresh();
          },
        },
      ],
    );
  const onPress = async () => {
    if (
      !current() ||
      lease.gate.current ||
      !scope.principalId ||
      !scope.databaseId
    )
      return;
    if (!online || !supported) {
      Alert.alert(
        t('mobileParity.billDetail.reviewPayment'),
        t('mobileParity.billDetail.paymentSupport'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.refresh'),
            onPress: () => {
              void refresh();
            },
          },
        ],
      );
      return;
    }
    if (session.intent?.blocked) {
      requestRefresh();
      return;
    }
    if (!session.intent) {
      const share = displayedBill?.share_info;
      if (
        !displayedBill ||
        !share ||
        !hasSettlementPreconditions({
          share_id: share.share_id,
          share_updated_at: share.share_updated_at,
          bill_updated_at: displayedBill.last_updated,
          due_date: displayedBill.next_due,
        })
      ) {
        requestRefresh();
        return;
      }
      session.intent = {
        bill: displayedBill,
        mutationId: randomUUID(),
        baseUpdatedAt: share.share_updated_at!,
        baseBillUpdatedAt: displayedBill.last_updated!,
        expectedDueDate: displayedBill.next_due,
        desiredPaid: !share.my_portion_paid,
        blocked: false,
      };
    }
    const intent = session.intent;
    lease.setBusy(true);
    try {
      const result = await api.markSharePaid(
        intent.bill.share_info!.share_id,
        scope,
        intent.mutationId,
        intent,
      );
      if (!current()) return;
      if (result.success || result.httpStatus === 409) {
        // A successful mutation also needs a real fresh read before an opposite action.
        intent.blocked = true;
        lease.setBusy(false);
        if (result.success) await refresh();
        else requestRefresh();
      } else
        Alert.alert(
          t('mobileParity.common.error'),
          result.error || t('mobileParity.billDetail.updateFailed'),
        );
    } catch {
      if (current())
        Alert.alert(
          t('mobileParity.common.error'),
          t('mobileParity.billDetail.updateFailed'),
        );
    } finally {
      lease.setBusy(false);
    }
  };
  return { bill: displayedBill, busy: lease.busy, onPress };
}
