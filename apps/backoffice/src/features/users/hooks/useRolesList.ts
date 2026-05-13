// apps/backoffice/src/features/users/hooks/useRolesList.ts
// Session 13 / Phase 5.D — Cached list of roles for selectors.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface RoleListRow {
  code:        string;
  name:        string;
  description: string | null;
  is_system:   boolean;
}

export const ROLES_LIST_KEY = ['roles-list'] as const;

export function useRolesList() {
  return useQuery<RoleListRow[]>({
    queryKey: ROLES_LIST_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('code, name, description, is_system')
        .order('code', { ascending: true });
      if (error !== null) throw new Error(error.message);
      return (data as unknown as RoleListRow[]) ?? [];
    },
  });
}
