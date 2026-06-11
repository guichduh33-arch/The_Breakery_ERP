// apps/backoffice/src/features/reports/hooks/usePermissionChanges.ts
// S40 Wave B3 — Query hook for get_permission_changes_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PermissionChangeLine {
  changed_at:       string;
  actor_name:       string;
  action:           string;
  role_code:        string | null;
  permission_code:  string | null;
  detail:           unknown;
}

export interface PermissionChangesData {
  period:    { start: string; end: string };
  changes:   PermissionChangeLine[];
  truncated: boolean;
}

export interface UsePermissionChangesParams {
  start: string;
  end:   string;
}

export function usePermissionChanges(params: UsePermissionChangesParams) {
  return useQuery<PermissionChangesData, Error>({
    queryKey: ['reports', 'permission-changes', params.start, params.end],
    queryFn:  async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_permission_changes_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        period:    raw.period    ?? { start: params.start, end: params.end },
        changes:   raw.changes   ?? [],
        truncated: raw.truncated ?? false,
      } satisfies PermissionChangesData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
