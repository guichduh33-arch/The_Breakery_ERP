// apps/backoffice/src/features/reports/hooks/usePriceChanges.ts
// S40 Wave B3 — Query hook for get_price_changes_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PriceChangeLine {
  changed_at:   string;
  actor_name:   string;
  product_id:   string;
  product_name: string;
  new_price:    number;
  old_price:    number | null;
  delta_pct:    number | null;
}

export interface PriceChangesData {
  period:    { start: string; end: string };
  changes:   PriceChangeLine[];
  truncated: boolean;
}

export interface UsePriceChangesParams {
  start:      string;
  end:        string;
  product_id?: string | null;
}

export function usePriceChanges(params: UsePriceChangesParams) {
  return useQuery<PriceChangesData, Error>({
    queryKey: ['reports', 'price-changes', params.start, params.end, params.product_id ?? null],
    queryFn:  async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_price_changes_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
        p_product_id: params.product_id ?? null,
      });
      if (error) throw error as Error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        period:    raw.period    ?? { start: params.start, end: params.end },
        changes:   raw.changes   ?? [],
        truncated: raw.truncated ?? false,
      } satisfies PriceChangesData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
