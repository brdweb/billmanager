import React, { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createSessionQueryClient } from '../services/sessionQueryClient';

function SessionQueryCache({ children }: { children: React.ReactNode }) {
  const [client] = useState(createSessionQueryClient);
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Replace the cache before children render when the account or server changes. */
export function SessionQueryProvider({ sessionKey, children }: {
  sessionKey: string;
  children: React.ReactNode;
}) {
  return <SessionQueryCache key={sessionKey}>{children}</SessionQueryCache>;
}
