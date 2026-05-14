// apps/backoffice/src/features/inventory-transfers/hooks/useInternalTransfers.ts
//
// Session 12 — Phase 3 — paginated list of internal transfers with embedded
// section names for the From → To column. The `internal_transfers` table is
// not yet in the generated Supabase types (it landed in migration 22 and the
// types regen is queued at the verification gate); we use an untyped
// `.from()` call and cast the result.

import { useQuery } from '@tanstack/react-query';
import type { TransferStatus } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';

export interface InternalTransferListRow {
  id:                string;
  transfer_number:   string;
  status:            TransferStatus;
  from_section_id:   string;
  to_section_id:     string;
  created_at:        string;
  transferred_at:    string | null;
  received_at:       string | null;
  notes:             string | null;
  // PostgREST embeds — both point to `sections`. The first uses the implicit
  // FK alias `internal_transfers_from_section_id_fkey`; the second uses an
  // explicit `to_section:sections!fk` alias to disambiguate.
  sections:    { code: string; name: string } | null;
  to_section:  { code: string; name: string } | null;
}

export interface InternalTransfersFilters {
  status?:         TransferStatus;
  fromSectionId?:  string;
  toSectionId?:    string;
  limit?:          number;
  offset?:         number;
}

export const INTERNAL_TRANSFERS_QUERY_KEY = ['internal-transfers'] as const;

const DEFAULT_LIMIT = 50;

/**
 * Minimal chainable shape of the PostgREST query builder we use here.
 * The real `PostgrestFilterBuilder<...>` from `@supabase/postgrest-js` is
 * generic over the Database type; since `internal_transfers` is not in
 * `types.generated.ts` yet we narrow to just the methods we touch.
 */
interface FilterChain {
  eq:    (col: string, val: unknown) => FilterChain;
  order: (col: string, opts?: { ascending?: boolean }) => FilterChain;
  range: (from: number, to: number) => Promise<{
    data:  unknown;
    error: Error | null;
  }>;
}

interface SelectStarter {
  select: (cols: string) => FilterChain;
}

export function useInternalTransfers(filters: InternalTransfersFilters = {}) {
  const limit  = filters.limit  ?? DEFAULT_LIMIT;
  const offset = filters.offset ?? 0;

  return useQuery<InternalTransferListRow[]>({
    queryKey: [...INTERNAL_TRANSFERS_QUERY_KEY, { ...filters, limit, offset }] as const,
    staleTime: 30_000,
    queryFn: async () => {
      // `internal_transfers` is not yet in `types.generated.ts`; cast the
      // supabase client to a tiny shape exposing an untyped `.from()`. We go
      // through the client object (not a pulled-out method ref) so `this`
      // stays bound.
      const sb = supabase as unknown as { from: (table: string) => SelectStarter };
      let query: FilterChain = sb.from('internal_transfers').select(
        'id, transfer_number, status, from_section_id, to_section_id, created_at, transferred_at, received_at, notes, ' +
        'sections!internal_transfers_from_section_id_fkey(code, name), ' +
        'to_section:sections!internal_transfers_to_section_id_fkey(code, name)',
      );

      if (filters.status !== undefined) {
        query = query.eq('status', filters.status);
      }
      if (filters.fromSectionId !== undefined && filters.fromSectionId !== '') {
        query = query.eq('from_section_id', filters.fromSectionId);
      }
      if (filters.toSectionId !== undefined && filters.toSectionId !== '') {
        query = query.eq('to_section_id', filters.toSectionId);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error !== null) throw error;
      return (data as InternalTransferListRow[] | null) ?? [];
    },
  });
}
