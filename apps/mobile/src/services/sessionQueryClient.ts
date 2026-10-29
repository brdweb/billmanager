import { QueryClient } from '@tanstack/react-query';

/** Never share this client across an authenticated session or server profile. */
export function createSessionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'offlineFirst', retry: 2, staleTime: 30_000 },
      mutations: { networkMode: 'offlineFirst', retry: 0 },
    },
  });
}
