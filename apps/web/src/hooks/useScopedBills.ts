import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as api from '../api/client';
import type { Bill } from '../api/client';

/** Keep responses and visible financial data bound to the current user/group. */
export function useScopedBills(userId: number | null, database: string | null) {
  const scope = userId !== null && database ? `${userId}:${database}` : null;
  const activeScope = useRef(scope);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => { activeScope.current = null; };
  }, [scope]);
  const requestId = useRef(0);
  const [result, setResult] = useState<{ scope: string | null; bills: Bill[]; loading: boolean }>({
    scope: null, bills: [], loading: false,
  });

  const fetchBills = useCallback(async () => {
    if (!scope || activeScope.current !== scope) return;
    const id = ++requestId.current;
    const isCurrent = () => activeScope.current === scope && requestId.current === id;
    setResult((previous) => ({ scope, bills: previous.scope === scope ? previous.bills : [], loading: true }));
    try {
      // Non-admin users cannot process auto-payments.
      try { await api.processAutoPayments(); } catch { /* Fetch bills regardless. */ }
      if (!isCurrent()) return;
      const bills = await api.getBills(true);
      if (isCurrent()) setResult({ scope, bills: Array.isArray(bills) ? bills : [], loading: false });
    } catch {
      if (isCurrent()) setResult({ scope, bills: [], loading: false });
    }
  }, [scope]);

  useEffect(() => {
    void fetchBills();
    return () => { requestId.current += 1; };
  }, [fetchBills]);

  return {
    bills: result.scope === scope ? result.bills : [],
    billsLoading: scope !== null && (result.scope !== scope || result.loading),
    fetchBills,
  };
}
