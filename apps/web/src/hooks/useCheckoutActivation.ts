import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api/client';
import type { SubscriptionStatus } from '../api/client';

/** Waits before each status check after checkout; about 60 seconds in total. */
export const CHECKOUT_ACTIVATION_DELAYS_MS = [1000, 2000, 3000, 5000, 7000, 10000, 15000, 17000];

/**
 * A trial already reports effective_tier "pro", so a purchase is only visible
 * once the subscription itself is active.
 */
export function isPaidPro(status: SubscriptionStatus | null | undefined): boolean {
  return status?.status === 'active' && status.effective_tier === 'pro';
}

/**
 * Polls billing status with bounded backoff while `enabled`, passing each
 * result to `onStatus`. Callers disable it once `isPaidPro` holds.
 */
export function useCheckoutActivation(
  enabled: boolean,
  onStatus: (status: SubscriptionStatus) => void
) {
  const [timedOut, setTimedOut] = useState(false);
  const [run, setRun] = useState(0);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (attempt: number) => {
      if (attempt >= CHECKOUT_ACTIVATION_DELAYS_MS.length) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(async () => {
        try {
          const next = await api.getSubscriptionStatus();
          if (cancelled) return;
          onStatusRef.current(next);
          if (isPaidPro(next)) return;
        } catch {
          // A failed check is retried on the next attempt.
        }
        if (!cancelled) schedule(attempt + 1);
      }, CHECKOUT_ACTIVATION_DELAYS_MS[attempt]);
    };

    schedule(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, run]);

  const retry = useCallback(() => {
    setTimedOut(false);
    setRun((value) => value + 1);
  }, []);

  return { timedOut, retry };
}
