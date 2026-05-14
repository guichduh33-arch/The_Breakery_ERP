// apps/backoffice/src/features/inventory-opname/hooks/useOpnameList.ts
// Session 13 / Phase 2.D — paginated list of inventory_counts rows.
//
// The `inventory_counts` table is in types.generated.ts so we use the
// strongly-typed `.from()` directly.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type OpnameStatus = 'draft' | 'counting' | 'review' | 'finalized' | 'cancelled';

export interface OpnameListRow {
  id:             string;
  count_number:   string;
  section_id:     string;
  status:         OpnameStatus;
  started_at:     string;
  finalized_at:   string | null;
  cancelled_at:   string | null;
  notes:          string | null;
  created_at:     string;
  section?:       { code: string; name: string } | null;
}

export interface OpnameListFilters {
  status?:        OpnameStatus;
  sectionId?:    string;
  limit?:        number;
  offset?:       number;
}

export const OPNAME_LIST_QUERY_KEY = ['inventory-counts'] as const;

const DEFAULT_LIMIT = 50;

export function useOpnameList(filters: OpnameListFilters = {}) {
  const limit  = filters.limit  ?? DEFAULT_LIMIT;
  const offset = filters.offset ?? 0;

  return useQuery<OpnameListRow[]>({
    queryKey: [...OPNAME_LIST_QUERY_KEY, { ...filters, limit, offset }] as const,
    staleTime: 30_000,
    queryFn: async () => {
      let query = supabase
        .from('inventory_counts')
        .select('id, count_number, section_id, status, started_at, finalized_at, cancelled_at, notes, created_at, section:sections(code, name)');

      if (filters.status !== undefined) {
        query = query.eq('status', filters.status);
      }
      if (filters.sectionId !== undefined && filters.sectionId !== '') {
        query = query.eq('section_id', filters.sectionId);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error !== null) throw error;
      return (data as unknown as OpnameListRow[]) ?? [];
    },
  });
}
