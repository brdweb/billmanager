import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api/client';
import i18n from '../i18n';
import { useAuth } from '../context/AuthContext';

export interface PaymentSnapshot {
  shareId: number; shareVersion?: string; billVersion?: string; dueDate: string; desiredPaid: boolean;
}
const version = (value?: string) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value);

/** Keep uncertain requests immutable; only a causal server read retires definite conflicts/success. */
export function useSharePayment(viewKey = '') {
  const { user, currentDb, isLoggedIn } = useAuth();
  const scope = JSON.stringify([isLoggedIn, user?.id, currentDb]);
  const lease = useMemo(() => ({ busy: false, scope, viewKey }), [scope, viewKey]);
  const active = useRef<typeof lease | null>(lease);
  const [, render] = useState(0);
  const attempts = useRef(new Map<string, { intent: api.SharePaymentIntent; blocked: boolean }>());
  useLayoutEffect(() => {
    active.current = lease;
    return () => { if (active.current === lease) active.current = null; };
  }, [lease]);
  const isCurrent = useCallback(() => active.current === lease && isLoggedIn && Boolean(user) && Boolean(currentDb)
    && api.isPaymentScopeCurrent(api.capturePaymentScope(user!.id)) && api.capturePaymentScope(user!.id).database === currentDb,
  [lease, isLoggedIn, user, currentDb]);
  const revision = useRef(0);
  const beginRead = useCallback(() => revision.current, []);
  const freshRead = useCallback((readRevision: number) => {
    if (readRevision !== revision.current) return;
    for (const [key, attempt] of attempts.current) if (attempt.blocked && key.startsWith(`${scope}:`)) attempts.current.delete(key);
  }, [scope]);
  const run = async (item: PaymentSnapshot, currentView: () => boolean, success: () => Promise<void> | void, conflict: () => Promise<void> | void) => {
    if (!isCurrent() || lease.busy || !currentView()) return;
    const requestScope = api.capturePaymentScope(user!.id);
    const current = () => isCurrent() && currentView() && api.isPaymentScopeCurrent(requestScope);
    if (!current() || requestScope.database !== currentDb) return;
    const key = `${scope}:${JSON.stringify([item.shareId, item.dueDate, item.desiredPaid])}`;
    revision.current += 1;
    lease.busy = true; render(value => value + 1);
    try {
      const config = await api.getAppConfig();
      if (!current()) return;
      if (!config.mobile?.features?.settlement_payment_desired_state || !version(item.shareVersion) || !version(item.billVersion)) {
        throw new Error(i18n.t('sharedPayment.serverRequired'));
      }
      let attempt = attempts.current.get(key);
      if (attempt?.blocked) { await conflict(); throw new Error(i18n.t('sharedPayment.refreshRequired')); }
      if (!attempt) {
        attempt = { blocked: false, intent: { client_mutation_id: crypto.randomUUID(), base_updated_at: item.shareVersion!,
          base_bill_updated_at: item.billVersion!, expected_due_date: item.dueDate, desired_paid: item.desiredPaid } };
        attempts.current.set(key, attempt);
      }
      await api.markSharePaid(item.shareId, attempt.intent, requestScope);
      attempt.blocked = true; revision.current += 1;
      if (current()) await success();
    } catch (error) {
      if (!current()) return;
      if (error instanceof api.ApiError && error.statusCode === 409) {
        const attempt = attempts.current.get(key);
        if (attempt) attempt.blocked = true;
        revision.current += 1;
        await conflict();
      }
      throw error;
    } finally {
      lease.busy = false;
      if (isCurrent()) render(value => value + 1);
    }
  };
  return { run, busy: lease.busy, isCurrent, freshRead, beginRead };
}
