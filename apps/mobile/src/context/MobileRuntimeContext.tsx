import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';

import { api } from '../api/client';
import { MobileCacheRepository, type CacheScope } from '../data/cacheRepository';
import { SQLiteSyncRepository } from '../data/syncRepository';
import {
  syncObjectKind,
  type SyncConflict,
  type SyncEntity,
  type SyncOperation,
} from '../domain/sync';
import { optimisticBillAfterPayment } from '../domain/optimisticPayment';
import { formatCurrency, formatDate } from '../i18n/format';
import {
  configureLocalNotifications,
  scheduleLocalBillReminders,
  subscribeToNotificationActions,
} from '../native/localNotifications';
import { registerBackgroundSync } from '../native/backgroundSync';
import { updateWidgetSnapshot } from '../native/widgetSnapshot';
import { getWidgetAmountsVisible, setWidgetAmountsVisible } from '../native/widgetPrivacy';
import { ApiOutboxMutationExecutor } from '../services/apiOutboxExecutor';
import { createOutboxMutation } from '../services/createOutboxMutation';
import {
  activateForegroundNativeSurfaceScope,
  type ForegroundNativeSurfaceLease,
  updateForegroundNativeSurfaces,
} from '../services/foregroundNativeSurfaces';
import { fetchForegroundSyncSnapshot } from '../services/foregroundSync';
import { activateNotificationScope } from '../services/notificationScope';
import { OutboxProcessor, type OutboxProcessSummary } from '../services/outboxProcessor';
import type { Bill, DatabaseInfo, Payment } from '../types';
import { useAuth } from './AuthContext';
import { runtimeScopeIsAligned } from './authOperationGuard';
import { useServerProfiles } from './ServerProfileContext';

const cacheRepository = new MobileCacheRepository();
const syncRepository = new SQLiteSyncRepository();
const outboxProcessor = new OutboxProcessor(
  syncRepository,
  new ApiOutboxMutationExecutor(api),
);

type ConflictResolution = 'use_server' | 'keep_local';

interface QueuedMutationInput {
  entity: SyncEntity;
  entityId: string | null;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  baseUpdatedAt?: string | null;
  dependsOn?: string | null;
}

interface MobileRuntimeContextValue {
  bills: Bill[];
  archivedBills: Bill[];
  payments: Payment[];
  groups: DatabaseInfo[];
  conflicts: SyncConflict[];
  loading: boolean;
  syncing: boolean;
  online: boolean;
  stale: boolean;
  lastSyncedAt: string | null;
  widgetAmountsVisible: boolean;
  error: string | null;
  syncNow: () => Promise<OutboxProcessSummary | null>;
  recordPayment: (input: {
    bill: Bill;
    amount?: number;
    paymentDate?: string;
    notes?: string;
    advanceDue?: boolean;
  }) => Promise<void>;
  createBill: (input: Partial<Bill>) => Promise<Bill>;
  updateBill: (bill: Bill, changes: Partial<Bill>) => Promise<void>;
  archiveBill: (bill: Bill) => Promise<void>;
  restoreBill: (bill: Bill) => Promise<void>;
  updatePayment: (payment: Payment, changes: Pick<Payment, 'amount' | 'payment_date' | 'notes'>) => Promise<void>;
  deletePayment: (payment: Payment) => Promise<void>;
  queueMutation: (input: QueuedMutationInput) => Promise<string>;
  resolveConflict: (mutationId: string, strategy: ConflictResolution) => Promise<void>;
  setWidgetAmountsVisible: (visible: boolean) => Promise<void>;
}

const MobileRuntimeContext = createContext<MobileRuntimeContextValue | null>(null);

function queryKeys(profileId: string, databaseId: string) {
  return {
    bills: ['mobile-cache', profileId, databaseId, 'bills'] as const,
    payments: ['mobile-cache', profileId, databaseId, 'payments'] as const,
    groups: ['mobile-cache', profileId, 'groups'] as const,
    conflicts: ['mobile-cache', profileId, databaseId, 'conflicts'] as const,
    sync: ['mobile-cache', profileId, databaseId, 'sync'] as const,
  };
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function runtimeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'BillManager could not synchronize.';
}

export function MobileRuntimeProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { isAuthenticated, currentDatabase, selectDatabase } = useAuth();
  const { activeProfile, switchProfile } = useServerProfiles();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [widgetAmountsVisible, setWidgetAmountsVisibleState] = useState(false);
  const syncPromises = useRef(new Map<string, Promise<OutboxProcessSummary | null>>());
  const nextTemporaryId = useRef(-Date.now());
  const nativeSurfaceLeaseRef = useRef<ForegroundNativeSurfaceLease | null>(null);

  const databaseId = currentDatabase ?? '';
  const contextRuntimeScope = useMemo(() => ({
    serverProfileId: activeProfile.id,
    databaseId: currentDatabase,
  }), [activeProfile.id, currentDatabase]);
  const scopeAligned = runtimeScopeIsAligned(
    contextRuntimeScope,
    api.captureAuthSessionScope(),
  );
  const scope = useMemo<CacheScope>(() => ({
    serverProfileId: activeProfile.id,
    databaseId,
  }), [activeProfile.id, databaseId]);
  const keys = useMemo(
    () => queryKeys(activeProfile.id, databaseId),
    [activeProfile.id, databaseId],
  );
  const enabled = isAuthenticated && Boolean(databaseId) && scopeAligned;

  const isScopeCurrent = useCallback((target: CacheScope = scope) => (
    runtimeScopeIsAligned(target, api.captureAuthSessionScope())
  ), [scope]);

  const requireCurrentScope = useCallback(() => {
    if (!isScopeCurrent()) {
      throw new Error('The active bill group changed. Please try again.');
    }
  }, [isScopeCurrent]);

  const billsQuery = useQuery({
    queryKey: keys.bills,
    queryFn: () => cacheRepository.getBills(scope, true),
    enabled,
    initialData: [],
  });
  const paymentsQuery = useQuery({
    queryKey: keys.payments,
    queryFn: () => cacheRepository.getPayments(scope),
    enabled,
    initialData: [],
  });
  const groupsQuery = useQuery({
    queryKey: keys.groups,
    queryFn: () => cacheRepository.getGroups(activeProfile.id),
    enabled: isAuthenticated,
    initialData: [],
  });
  const conflictsQuery = useQuery({
    queryKey: keys.conflicts,
    queryFn: () => syncRepository.getConflicts(activeProfile.id, databaseId),
    enabled,
    initialData: [],
  });
  const syncStateQuery = useQuery({
    queryKey: keys.sync,
    queryFn: () => syncRepository.getSyncState(activeProfile.id, databaseId),
    enabled,
  });

  const refreshLocalQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.bills }),
      queryClient.invalidateQueries({ queryKey: keys.payments }),
      queryClient.invalidateQueries({ queryKey: keys.groups }),
      queryClient.invalidateQueries({ queryKey: keys.conflicts }),
      queryClient.invalidateQueries({ queryKey: keys.sync }),
    ]);
  }, [keys, queryClient]);

  const updateNativeSurfaces = useCallback(async (
    bills: Bill[],
    targetScope: CacheScope,
    lease: ForegroundNativeSurfaceLease | null,
    options: { scheduleReminders?: boolean } = {},
  ) => {
    await updateForegroundNativeSurfaces({
      lease,
      scope: targetScope,
      scheduleReminders: options.scheduleReminders === false
        ? undefined
        : () => scheduleLocalBillReminders(bills, { scope: targetScope }).catch(() => 0),
      writeWidget: Platform.OS === 'web'
        ? undefined
        : async () => {
            const nextBill = [...bills]
              .filter((bill) => !bill.archived)
              .sort((left, right) => left.next_due.localeCompare(right.next_due))[0];
            const remaining = bills
              .filter((bill) => !bill.archived && bill.type === 'expense')
              .reduce((total, bill) => total + (bill.amount ?? bill.avg_amount ?? 0), 0);
            await updateWidgetSnapshot({
              billId: nextBill?.id ?? null,
              nextUpLabel: t('mobileParity.widget.nextUp'),
              title: nextBill?.name ?? t('mobileParity.widget.noUpcoming'),
              dueLabel: nextBill ? formatDate(nextBill.next_due) : t('mobileParity.widget.caughtUp'),
              amountLabel: nextBill ? formatCurrency(nextBill.amount ?? nextBill.avg_amount) : '',
              remainingThisMonthLabel: t('mobileParity.widget.remainingThisMonth', {
                amount: formatCurrency(remaining),
              }),
              showAmounts: widgetAmountsVisible,
            });
          },
    }).catch(() => false);
  }, [t, widgetAmountsVisible]);

  useEffect(() => {
    const lease = activateForegroundNativeSurfaceScope(scope);
    nativeSurfaceLeaseRef.current = lease;
    return () => {
      if (nativeSurfaceLeaseRef.current === lease) nativeSurfaceLeaseRef.current = null;
      lease.release();
    };
  }, [scope]);

  useEffect(() => {
    // The widget store is global. Clear the previous scope immediately, even
    // when the new scope is signed out, has no cached bills, or cannot
    // synchronize offline.
    void updateNativeSurfaces([], scope, nativeSurfaceLeaseRef.current, {
      scheduleReminders: false,
    });
  }, [scope, updateNativeSurfaces]);

  const updateWidgetPrivacy = useCallback(async (visible: boolean) => {
    await setWidgetAmountsVisible(visible);
    setWidgetAmountsVisibleState(visible);
  }, []);

  const performSync = useCallback(async (): Promise<OutboxProcessSummary | null> => {
    if (!enabled || !isScopeCurrent()) return null;
    const syncScope = { ...scope };
    const syncLease = nativeSurfaceLeaseRef.current;
    const isApiScopeCurrent = () => isScopeCurrent(syncScope);
    const isStillActive = () => (
      isApiScopeCurrent() && syncLease?.isActive(syncScope) === true
    );
    const connection = await NetInfo.fetch();
    if (!isApiScopeCurrent()) return null;
    const isConnected = connection.isConnected === true && connection.isInternetReachable !== false;
    setOnline(isConnected);
    onlineManager.setOnline(isConnected);
    if (!isConnected) {
      if (isStillActive()) setError(null);
      await refreshLocalQueries();
      return { attempted: 0, completed: 0, conflicts: 0, retries: 0 };
    }

    if (isStillActive()) setError(null);
    const existingSyncState = await syncRepository.getSyncState(
      syncScope.serverProfileId,
      syncScope.databaseId,
    );
    await syncRepository.setSyncState(syncScope.serverProfileId, syncScope.databaseId, {
      cursor: existingSyncState?.cursor ?? null,
      lastSyncedAt: existingSyncState?.lastSyncedAt ?? null,
      status: 'syncing',
      lastError: null,
    });

    try {
      const summary = await outboxProcessor.process(
        syncScope.serverProfileId,
        syncScope.databaseId,
      );
      const snapshot = await fetchForegroundSyncSnapshot(api, syncScope);

      const unresolved = await syncRepository.hasUnresolvedMutations(
        syncScope.serverProfileId,
        syncScope.databaseId,
      );
      if (!unresolved) await cacheRepository.markScopeClean(syncScope);
      await Promise.all([
        cacheRepository.replaceBills(syncScope, snapshot.bills),
        cacheRepository.replacePayments(syncScope, snapshot.payments),
      ]);

      await cacheRepository.replaceGroups(syncScope.serverProfileId, snapshot.groups);
      await syncRepository.pruneCompleted(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      );
      const synchronizedAt = new Date().toISOString();
      await syncRepository.setSyncState(syncScope.serverProfileId, syncScope.databaseId, {
        cursor: null,
        lastSyncedAt: synchronizedAt,
        status: 'idle',
        lastError: null,
      });
      if (isApiScopeCurrent()) {
        await updateNativeSurfaces(snapshot.bills, syncScope, syncLease);
      }
      await refreshLocalQueries();
      return summary;
    } catch (reason) {
      const message = runtimeError(reason);
      if (isStillActive()) setError(message);
      await syncRepository.setSyncState(syncScope.serverProfileId, syncScope.databaseId, {
        cursor: existingSyncState?.cursor ?? null,
        lastSyncedAt: existingSyncState?.lastSyncedAt ?? null,
        status: 'error',
        lastError: message,
      });
      await refreshLocalQueries();
      throw reason;
    }
  }, [
    enabled,
    isScopeCurrent,
    refreshLocalQueries,
    scope,
    updateNativeSurfaces,
  ]);

  const syncNow = useCallback(() => {
    const scopeKey = `${scope.serverProfileId}\u0000${scope.databaseId}`;
    const current = syncPromises.current.get(scopeKey);
    if (current) return current;
    setSyncing(true);
    const running = performSync().finally(() => {
      syncPromises.current.delete(scopeKey);
      setSyncing(syncPromises.current.size > 0);
    });
    syncPromises.current.set(scopeKey, running);
    return running;
  }, [performSync, scope.databaseId, scope.serverProfileId]);

  const queueMutation = useCallback(async (input: QueuedMutationInput): Promise<string> => {
    if (!enabled) throw new Error('Choose a bill group before making changes.');
    requireCurrentScope();
    const sameEntityDependency = input.entityId
      ? syncObjectKind(input.entity) === 'bill'
        ? await syncRepository.findLatestPendingForBill(
            activeProfile.id,
            databaseId,
            input.entityId,
          )
        : await syncRepository.findLatestPendingForEntity(
            activeProfile.id,
            databaseId,
            input.entity,
            input.entityId,
          )
      : null;
    const mutation = createOutboxMutation({
      serverProfileId: activeProfile.id,
      databaseId,
      ...input,
      dependsOn: sameEntityDependency ?? input.dependsOn ?? null,
    });
    await syncRepository.enqueue(mutation);
    await refreshLocalQueries();
    if (online) void syncNow().catch(() => undefined);
    return mutation.id;
  }, [
    activeProfile.id,
    databaseId,
    enabled,
    online,
    refreshLocalQueries,
    requireCurrentScope,
    syncNow,
  ]);

  const recordPayment = useCallback(async ({
    bill,
    amount = bill.amount ?? bill.avg_amount ?? 0,
    paymentDate = todayIso(),
    notes,
    advanceDue = true,
  }: {
    bill: Bill;
    amount?: number;
    paymentDate?: string;
    notes?: string;
    advanceDue?: boolean;
  }) => {
    requireCurrentScope();
    const temporaryPaymentId = nextTemporaryId.current--;
    const temporaryPayment: Payment = {
      id: temporaryPaymentId,
      bill_id: bill.id,
      amount,
      payment_date: paymentDate,
      notes: notes ?? null,
      created_at: new Date().toISOString(),
      bill_name: bill.name,
      bill_icon: bill.icon,
      bill_type: bill.type,
      database_id: bill.database_id,
      database_name: bill.database_name,
    };
    await cacheRepository.upsertPayments(scope, [temporaryPayment], { dirty: true });
    const dependsOn = await syncRepository.findLatestPendingForBill(
      activeProfile.id,
      databaseId,
      String(bill.id),
    );
    await queueMutation({
      entity: 'payment',
      entityId: String(temporaryPaymentId),
      operation: 'create',
      payload: {
        bill_id: bill.id,
        amount,
        payment_date: paymentDate,
        notes: notes ?? null,
        advance_due: advanceDue,
      },
      baseUpdatedAt: bill.last_updated ?? null,
      dependsOn,
    });
    const updatedBill = optimisticBillAfterPayment(bill, advanceDue);
    if (updatedBill) {
      await cacheRepository.upsertBills(scope, [updatedBill], { dirty: true });
    }
    await refreshLocalQueries();
  }, [
    activeProfile.id,
    databaseId,
    queueMutation,
    refreshLocalQueries,
    requireCurrentScope,
    scope,
  ]);

  const createBill = useCallback(async (input: Partial<Bill>): Promise<Bill> => {
    requireCurrentScope();
    if (!input.name?.trim()) throw new Error('A bill name is required.');
    if (!input.next_due) throw new Error('A next due date is required.');
    const temporaryId = nextTemporaryId.current--;
    const bill: Bill = {
      id: temporaryId,
      name: input.name.trim(),
      amount: input.varies ? null : (input.amount ?? null),
      varies: input.varies ?? false,
      frequency: input.frequency ?? 'monthly',
      frequency_type: input.frequency_type ?? 'simple',
      frequency_config: input.frequency_config ?? '{}',
      next_due: input.next_due,
      auto_payment: input.auto_payment ?? false,
      reminder_enabled: input.reminder_enabled ?? true,
      reminder_days: input.reminder_days ?? [0, 1, 3, 7],
      icon: input.icon ?? 'payment',
      type: input.type ?? 'expense',
      account: input.account ?? null,
      category: input.category ?? null,
      notes: input.notes ?? null,
      archived: false,
      is_shared: false,
      database_id: input.database_id,
      database_name: input.database_name,
    };
    await cacheRepository.upsertBills(scope, [bill], { dirty: true });
    const { id: _id, archived: _archived, is_shared: _isShared, ...payload } = bill;
    await queueMutation({
      entity: 'bill',
      entityId: String(temporaryId),
      operation: 'create',
      payload,
    });
    await refreshLocalQueries();
    return bill;
  }, [queueMutation, refreshLocalQueries, requireCurrentScope, scope]);

  const updateBill = useCallback(async (bill: Bill, changes: Partial<Bill>) => {
    requireCurrentScope();
    const updated: Bill = { ...bill, ...changes };
    await cacheRepository.upsertBills(scope, [updated], { dirty: true });
    const dependsOn = bill.id < 0
      ? await syncRepository.findPendingCreate(
          activeProfile.id,
          databaseId,
          'bill',
          String(bill.id),
        )
      : null;
    await queueMutation({
      entity: 'bill',
      entityId: String(bill.id),
      operation: 'update',
      payload: changes as Record<string, unknown>,
      baseUpdatedAt: bill.last_updated ?? null,
      dependsOn,
    });
    await refreshLocalQueries();
  }, [
    activeProfile.id,
    databaseId,
    queueMutation,
    refreshLocalQueries,
    requireCurrentScope,
    scope,
  ]);

  const archiveBill = useCallback(async (bill: Bill) => {
    requireCurrentScope();
    await cacheRepository.upsertBills(scope, [{ ...bill, archived: true }], { dirty: true });
    const dependsOn = bill.id < 0
      ? await syncRepository.findPendingCreate(
          activeProfile.id,
          databaseId,
          'bill',
          String(bill.id),
        )
      : null;
    await queueMutation({
      entity: 'bill_archive',
      entityId: String(bill.id),
      operation: 'delete',
      payload: {},
      baseUpdatedAt: bill.last_updated ?? null,
      dependsOn,
    });
    await refreshLocalQueries();
  }, [
    activeProfile.id,
    databaseId,
    queueMutation,
    refreshLocalQueries,
    requireCurrentScope,
    scope,
  ]);

  const restoreBill = useCallback(async (bill: Bill) => {
    requireCurrentScope();
    await cacheRepository.upsertBills(scope, [{ ...bill, archived: false }], { dirty: true });
    const dependsOn = bill.id < 0
      ? await syncRepository.findPendingCreate(
          activeProfile.id,
          databaseId,
          'bill',
          String(bill.id),
        )
      : null;
    await queueMutation({
      entity: 'bill_restore',
      entityId: String(bill.id),
      operation: 'action',
      payload: {},
      baseUpdatedAt: bill.last_updated ?? null,
      dependsOn,
    });
    await refreshLocalQueries();
  }, [
    activeProfile.id,
    databaseId,
    queueMutation,
    refreshLocalQueries,
    requireCurrentScope,
    scope,
  ]);

  const updatePayment = useCallback(async (
    payment: Payment,
    changes: Pick<Payment, 'amount' | 'payment_date' | 'notes'>,
  ) => {
    requireCurrentScope();
    const updated: Payment = {
      ...payment,
      ...changes,
      updated_at: new Date().toISOString(),
    };
    await cacheRepository.upsertPayments(scope, [updated], { dirty: true });
    const dependsOn = payment.id < 0
      ? await syncRepository.findPendingCreate(
          activeProfile.id,
          databaseId,
          'payment',
          String(payment.id),
        )
      : null;
    await queueMutation({
      entity: 'payment',
      entityId: String(payment.id),
      operation: 'update',
      payload: {
        amount: changes.amount,
        payment_date: changes.payment_date,
        notes: changes.notes,
      },
      baseUpdatedAt: payment.updated_at ?? null,
      dependsOn,
    });
    await refreshLocalQueries();
  }, [
    activeProfile.id,
    databaseId,
    queueMutation,
    refreshLocalQueries,
    requireCurrentScope,
    scope,
  ]);

  const deletePayment = useCallback(async (payment: Payment) => {
    requireCurrentScope();
    await cacheRepository.upsertPayments(scope, [payment], {
      dirty: true,
      deletedIds: [String(payment.id)],
    });
    const dependsOn = payment.id < 0
      ? await syncRepository.findPendingCreate(
          activeProfile.id,
          databaseId,
          'payment',
          String(payment.id),
        )
      : null;
    await queueMutation({
      entity: 'payment',
      entityId: String(payment.id),
      operation: 'delete',
      payload: {},
      baseUpdatedAt: payment.updated_at ?? null,
      dependsOn,
    });
    await refreshLocalQueries();
  }, [
    activeProfile.id,
    databaseId,
    queueMutation,
    refreshLocalQueries,
    requireCurrentScope,
    scope,
  ]);

  const resolveConflict = useCallback(async (mutationId: string, strategy: ConflictResolution) => {
    requireCurrentScope();
    const conflict = await syncRepository.resolveConflict(mutationId, strategy);
    if (!conflict) return;
    if (strategy === 'use_server' && conflict.server && typeof conflict.server === 'object') {
      const permanentFailure = '__sync_failure' in conflict.server;
      if (permanentFailure && conflict.entityId) {
        await cacheRepository.markEntityClean(
          scope,
          conflict.entity === 'payment' ? 'payment' : 'bill',
          conflict.entityId,
        );
      }
      if (!permanentFailure && (
        conflict.entity === 'bill'
        || conflict.entity === 'bill_archive'
        || conflict.entity === 'bill_restore'
      )) {
        await cacheRepository.upsertBills(scope, [conflict.server as Bill]);
      } else if (!permanentFailure && conflict.entity === 'payment') {
        await cacheRepository.upsertPayments(scope, [conflict.server as Payment]);
      }
    }
    await refreshLocalQueries();
    if (online) await syncNow();
  }, [online, refreshLocalQueries, requireCurrentScope, scope, syncNow]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
      if (state === 'active' && enabled) void syncNow().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [enabled, syncNow]);

  useEffect(() => NetInfo.addEventListener((state) => {
    const nextOnline = state.isConnected === true && state.isInternetReachable !== false;
    setOnline(nextOnline);
    onlineManager.setOnline(nextOnline);
    if (nextOnline && enabled) void syncNow().catch(() => undefined);
  }), [enabled, syncNow]);

  useEffect(() => {
    if (!enabled) return;
    void syncNow().catch(() => undefined);
  }, [enabled, scope, syncNow]);

  useEffect(() => {
    void getWidgetAmountsVisible().then(setWidgetAmountsVisibleState).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (
      !enabled
      || (billsQuery.data.length === 0 && !billsQuery.isFetchedAfterMount)
    ) return;
    void updateNativeSurfaces(billsQuery.data, scope, nativeSurfaceLeaseRef.current);
  }, [
    billsQuery.data,
    billsQuery.isFetchedAfterMount,
    enabled,
    scope,
    updateNativeSurfaces,
    widgetAmountsVisible,
  ]);

  useEffect(() => {
    void configureLocalNotifications();
    const activateScope = (target: CacheScope) => activateNotificationScope(target, {
      getActiveProfileId: () => api.getActiveProfile().id,
      getCurrentDatabase: () => api.getCurrentDatabase(),
      switchProfile,
      selectDatabase,
    });
    const unsubscribe = subscribeToNotificationActions({
      onOpenBill: async (billId, target) => {
        await activateScope(target);
        await Linking.openURL(`billmanager://bills/${billId}`);
      },
      onMarkPaid: async (billId, target) => {
        const targetBills = await cacheRepository.getBills(target, true);
        const bill = targetBills.find((candidate) => candidate.id === billId);
        if (!bill) return;
        const temporaryId = -Date.now();
        const payment: Payment = {
          id: temporaryId,
          bill_id: bill.id,
          amount: bill.amount ?? bill.avg_amount ?? 0,
          payment_date: todayIso(),
          notes: null,
          created_at: new Date().toISOString(),
          bill_name: bill.name,
          bill_icon: bill.icon,
          bill_type: bill.type,
          database_id: bill.database_id,
          database_name: bill.database_name,
        };
        await cacheRepository.upsertPayments(target, [payment], { dirty: true });
        const dependsOn = await syncRepository.findLatestPendingForBill(
          target.serverProfileId,
          target.databaseId,
          String(bill.id),
        );
        await syncRepository.enqueue(createOutboxMutation({
          serverProfileId: target.serverProfileId,
          databaseId: target.databaseId,
          entity: 'payment',
          entityId: String(temporaryId),
          operation: 'create',
          payload: {
            bill_id: bill.id,
            amount: payment.amount,
            payment_date: payment.payment_date,
            notes: null,
            advance_due: true,
          },
          baseUpdatedAt: bill.last_updated ?? null,
          dependsOn,
        }));
        const updatedBill = optimisticBillAfterPayment(bill, true);
        if (updatedBill) {
          await cacheRepository.upsertBills(target, [updatedBill], { dirty: true });
        }
        await activateScope(target);
        await Linking.openURL(`billmanager://bills/${billId}`);
      },
      onSnooze: async (billId, target, snoozedUntil, notificationId, dueDate) => {
        const existing = (await cacheRepository.getReminderStates(target))
          .find((state) => state.billId === String(billId));
        await cacheRepository.putReminderState(target, {
          billId: String(billId),
          notificationIds: [...new Set([...(existing?.notificationIds ?? []), notificationId])],
          nextScheduledAt: snoozedUntil,
          snoozedUntil,
          dismissedDueDate: existing?.dismissedDueDate === dueDate ? null : existing?.dismissedDueDate ?? null,
          updatedAt: new Date().toISOString(),
        });
      },
    });
    return unsubscribe;
  }, [selectDatabase, switchProfile]);

  useEffect(() => {
    if (!enabled) return;
    // Registration is intentionally durable across provider unmounts and
    // profile switches. The headless task discovers every persisted scope.
    void registerBackgroundSync();
  }, [enabled]);

  const value = useMemo<MobileRuntimeContextValue>(() => ({
    bills: enabled ? billsQuery.data.filter((bill) => !bill.archived) : [],
    archivedBills: enabled ? billsQuery.data.filter((bill) => bill.archived) : [],
    payments: enabled ? paymentsQuery.data : [],
    groups: enabled ? groupsQuery.data : [],
    conflicts: enabled ? conflictsQuery.data : [],
    loading: isAuthenticated && Boolean(databaseId) && (
      !scopeAligned
      || billsQuery.isLoading
      || paymentsQuery.isLoading
      || groupsQuery.isLoading
    ),
    syncing,
    online,
    stale: enabled && (!online || syncStateQuery.data?.status === 'error'),
    lastSyncedAt: enabled ? syncStateQuery.data?.lastSyncedAt ?? null : null,
    widgetAmountsVisible,
    error: enabled ? error ?? syncStateQuery.data?.lastError ?? null : null,
    syncNow,
    recordPayment,
    createBill,
    updateBill,
    archiveBill,
    restoreBill,
    updatePayment,
    deletePayment,
    queueMutation,
    resolveConflict,
    setWidgetAmountsVisible: updateWidgetPrivacy,
  }), [
    archiveBill,
    billsQuery.data,
    billsQuery.isLoading,
    conflictsQuery.data,
    databaseId,
    enabled,
    error,
    groupsQuery.data,
    groupsQuery.isLoading,
    online,
    paymentsQuery.data,
    paymentsQuery.isLoading,
    queueMutation,
    recordPayment,
    resolveConflict,
    restoreBill,
    isAuthenticated,
    scopeAligned,
    updateBill,
    updatePayment,
    deletePayment,
    syncNow,
    syncStateQuery.data?.lastError,
    syncStateQuery.data?.lastSyncedAt,
    syncStateQuery.data?.status,
    syncing,
    updateWidgetPrivacy,
    widgetAmountsVisible,
  ]);

  return <MobileRuntimeContext.Provider value={value}>{children}</MobileRuntimeContext.Provider>;
}

export function useMobileRuntime(): MobileRuntimeContextValue {
  const context = useContext(MobileRuntimeContext);
  if (!context) throw new Error('useMobileRuntime must be used inside MobileRuntimeProvider');
  return context;
}
