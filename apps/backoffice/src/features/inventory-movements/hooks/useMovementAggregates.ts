// apps/backoffice/src/features/inventory-movements/hooks/useMovementAggregates.ts
// Session 13 / Phase 2.D — get_movement_aggregates wrapper.
//
// 2026-08-05 — bump v1 → v2. La v1 valorisait un mouvement au `unit_cost` STOCKÉ
// (`COALESCE(sm.unit_cost, p.cost_price)`) alors que le tableau de la même page
// (`get_stock_movement_ledger_v1`) le valorise au coût COURANT du produit. Une
// unique ligne historique au `unit_cost` ×1000 pesait 47 % de la tuile
// « Value moved ». La v2 aligne l'agrégat sur le tableau.

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
      // Bare 'YYYY-MM-DD' bounds would parse as 00:00 in the session timezone, so an
      // end == start (e.g. the "Today" preset) excludes the whole day's movements.
      // Send explicit start-of-day / end-of-day so the day is fully covered (parsed in
      // the DB session timezone = business Asia/Makassar). Matches the ledger RPC fix.
      if (filters.dateStart !== undefined && filters.dateStart !== '') args.p_date_start = `${filters.dateStart}T00:00:00`;
      if (filters.dateEnd   !== undefined && filters.dateEnd   !== '') args.p_date_end   = `${filters.dateEnd}T23:59:59.999`;
      const { data, error } = await rpc()('get_movement_aggregates_v2', args);
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
  });
}
