import { useLayoutEffect, useMemo, useReducer, useRef } from 'react';

/** A UI lease expires on scope changes/unmount, even if stored credentials remain valid. */
export function useActionScope(scope: string) {
  const [, render] = useReducer((version: number) => version + 1, 0);
  const lease = useMemo(() => ({ gate: { current: false } }), [scope]);
  const active = useRef<typeof lease | null>(lease);
  useLayoutEffect(() => {
    active.current = lease;
    return () => { if (active.current === lease) active.current = null; };
  }, [lease]);
  const isActive = () => active.current === lease;
  return {
    gate: lease.gate,
    busy: lease.gate.current,
    isActive,
    setBusy: (busy: boolean) => {
      lease.gate.current = busy;
      if (isActive()) render();
    },
  };
}
