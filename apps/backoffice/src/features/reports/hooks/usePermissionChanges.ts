// apps/backoffice/src/features/reports/hooks/usePermissionChanges.ts
// Rapport « Permission changes » — lecture de la famille RPC
// `get_permission_changes`. ADR-031 a bumpé la fonction : la v1 est droppée,
// la v2 garde la même signature (p_date_start / p_date_end en texte).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toStr } from '../utils/parse.js';

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
      const { data, error } = await supabase.rpc('get_permission_changes_v2', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      const raw    = asRecord(data);
      const period = asRecord(raw.period);
      return {
        period: {
          start: toStr(period.start, params.start),
          end:   toStr(period.end,   params.end),
        },
        changes: asArray(raw.changes).map((c): PermissionChangeLine => {
          const o = asRecord(c);
          return {
            changed_at:      toStr(o.changed_at),
            actor_name:      toStr(o.actor_name, '—'),
            action:          toStr(o.action),
            role_code:       typeof o.role_code === 'string' ? o.role_code : null,
            permission_code: typeof o.permission_code === 'string' ? o.permission_code : null,
            detail:          o.detail,
          };
        }),
        truncated: raw.truncated === true,
      } satisfies PermissionChangesData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
