// apps/backoffice/src/features/inventory/hooks/useExpiringLots.ts
//
// Session 13 — F1 expiry tracking. Calls `get_expiring_lots_v1` to surface
// the BO Expiring Stock page and the sidebar badge count.
//
// Returns ALL active lots whose expires_at falls within the next `hoursAhead`
// hours, including already-past-expiry-but-not-yet-cron-swept lots (the UI
// renders those as "expired (pending sweep)").
//
// Spec ref: docs/workplan/plans/2026-05-13-session-13-INDEX.md lines 328-378.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ExpiringLotRow {
  id:               string;
  product_id:       string;
  product_sku:      string;
  product_name:     string;
  location_id:      string | null;
  location_name:    string | null;
  quantity:         number;
  unit:             string;
  expires_at:       string;
  received_at:      string;
  batch_number:     string | null;
  status:           'active' | 'expired' | 'consumed';
  hours_remaining:  number;
  total_count:      number;
}

export interface ExpiringLotsFilters {
  hoursAhead?: number;
  productId?:  string;
  limit?:      number;
  offset?:     number;
}

export const EXPIRING_LOTS_QUERY_KEY = ['expiring-lots'] as const;

const DEFAULT_HOURS = 24;
const DEFAULT_LIMIT = 100;

export function useExpiringLots(filters: ExpiringLotsFilters = {}) {
  const hoursAhead = filters.hoursAhead ?? DEFAULT_HOURS;
  const limit      = filters.limit ?? DEFAULT_LIMIT;
  const offset     = filters.offset ?? 0;

  return useQuery<ExpiringLotRow[]>({
    queryKey: [...EXPIRING_LOTS_QUERY_KEY, { hoursAhead, productId: filters.productId, limit, offset }] as const,
    // The page refreshes every minute so a lot crossing the 0h-remaining
    // boundary surfaces promptly without manual refresh.
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const args: {
        p_hours_ahead: number;
        p_product_id?: string;
        p_limit:       number;
        p_offset:      number;
      } = {
        p_hours_ahead: hoursAhead,
        p_limit:       limit,
        p_offset:      offset,
      };
      if (filters.productId !== undefined && filters.productId !== '') {
        args.p_product_id = filters.productId;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types regenerate after migration apply
      const { data, error } = await (supabase as any).rpc('get_expiring_lots_v1', args);
      if (error) throw error;
      return (data ?? []) as ExpiringLotRow[];
    },
  });
}
