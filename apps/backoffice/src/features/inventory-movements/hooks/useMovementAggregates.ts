// apps/backoffice/src/features/inventory-movements/hooks/useMovementAggregates.ts
// Session 13 / Phase 2.D — get_movement_aggregates_v1 wrapper.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface MovementAggregate {
  movement_type: string;
  count:         number;
  qty_total:     number;
  value_total:   number | null;
}

export interface AggregateFilters {
  sectionId?:  string;
  productId?:  string;
  dateStart?:  string;
  dateEnd?:    string;
}

type RpcFn = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: MovementAggregate[] | null; error: { message: string } | null }>;

function rpc(): RpcFn {
  return supabase.rpc.bind(supabase) as unknown as RpcFn;
}

export function useMovementAggregates(filters: AggregateFilters = {}) {
  return useQuery<MovementAggregate[]>({
    queryKey: ['movement-aggregates', filters] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const args: Record<string, unknown> = {};
      if (filters.sectionId !== undefined && filters.sectionId !== '') args.p_section_id = filters.sectionId;
      if (filters.productId !== undefined && filters.productId !== '') args.p_product_id = filters.productId;
      if (filters.dateStart !== undefined && filters.dateStart !== '') args.p_date_start = filters.dateStart;
      if (filters.dateEnd   !== undefined && filters.dateEnd   !== '') args.p_date_end   = filters.dateEnd;
      const { data, error } = await rpc()('get_movement_aggregates_v1', args);
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
  });
}
