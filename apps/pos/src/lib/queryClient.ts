// apps/pos/src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

/**
 * Treat auth/permission failures as terminal — retrying them does nothing but
 * hammer the backend (the >700-request storm observed when the PIN bearer was
 * missing on reload). PostgREST surfaces these either as an HTTP status
 * (401/403) or a PostgrestError code (`42501` insufficient_privilege, `PGRST301`
 * JWT expired/invalid), so we check both shapes.
 */
function isAuthError(error: unknown): boolean {
  const e = error as { status?: number; code?: string } | null;
  if (!e) return false;
  if (e.status === 401 || e.status === 403) return true;
  return e.code === '42501' || e.code === 'PGRST301' || e.code === 'PGRST302';
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,    // 5 min
      gcTime: 30 * 60 * 1000,      // keep cache 30 min so nav back stays instant
      // Never retry auth/permission errors; otherwise up to 2 retries with
      // exponential backoff (1s, 2s … capped at 30s).
      retry: (failureCount, error) => {
        if (isAuthError(error)) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: (failureCount, error) => {
        if (isAuthError(error)) return false;
        return failureCount < 1;
      },
    },
  },
});
