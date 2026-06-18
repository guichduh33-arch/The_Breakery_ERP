// apps/backoffice/src/features/products/hooks/useProductAnalytics.ts
//
// Wrapper around the get_product_analytics_v1 RPC powering the product detail
// "Stock / Analytics" tab. Mirrors the useProductDashboard pattern: the RPC
// returns a single JSONB document, so we declare the shape locally and cast the
// bound rpc (no generated types — the cloud schema lags local migrations).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface AnalyticsProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  product_type: string | null;
  is_semi_finished: boolean;
  cost_price: number;
  retail_price: number;
  current_stock: number;
  min_stock_threshold: number | null;
  value_at_cost: number;
}

export interface AnalyticsKpis {
  current_stock: number;
  unit: string;
  stock_value: number;
  unit_cost: number;
  consumption_window: number;
  avg_daily_consumption: number;
  days_remaining: number | null;
  min_stock_threshold: number;
  stock_status: 'out' | 'low' | 'ok';
}

export interface TimelinePoint { day: string; balance: number }
export interface MovementBreakdownRow {
  movement_type: string;
  count: number;
  qty_total: number;
  value_total: number;
}
export interface WeeklyPoint { week_start: string; units: number }
export interface PriceTrendPoint { date: string; unit_cost: number; po_number: string }
export interface PurchasePatternRow { month: string; qty: number; order_count: number }
export interface RecipeUsageRow {
  product_id: string;
  product_name: string;
  product_type: string | null;
  is_semi_finished: boolean;
  qty_per_batch: number;
  unit: string;
  demand_pct: number;
  est_used: number;
}
export interface IncomingPoRow {
  po_id: string;
  po_number: string;
  status: string;
  quantity: number;
  received_quantity: number | null;
  unit: string;
  unit_cost: number | null;
  order_date: string | null;
  expected_date: string | null;
  received_date: string | null;
}
export interface ProductionRow {
  id: string;
  production_number: string;
  quantity_produced: number;
  quantity_waste: number;
  actual_yield_qty: number | null;
  expected_yield_qty: number | null;
  batch_number: string | null;
  production_date: string;
  reverted: boolean;
}
export interface TransferRow {
  id: string;
  transfer_number: string;
  quantity_requested: number;
  quantity_received: number | null;
  unit: string;
  status: string;
  from_section_code: string | null;
  to_section_code: string | null;
  transferred_at: string | null;
  created_at: string;
}
export interface WastageRow {
  id: string;
  quantity: number;
  unit: string;
  reason: string | null;
  value: number;
  created_at: string;
}
export interface OpnameRow {
  id: string;
  count_number: string;
  status: string;
  expected_qty: number | null;
  counted_qty: number | null;
  variance: number | null;
  unit: string | null;
  finalized_at: string | null;
  created_at: string;
}
export interface RecentMovementRow {
  id: string;
  movement_type: string;
  quantity: number;
  unit: string;
  reason: string | null;
  from_section_code: string | null;
  to_section_code: string | null;
  created_at: string;
}

export interface ProductAnalyticsData {
  product: AnalyticsProduct;
  window_days: number;
  kpis: AnalyticsKpis;
  stock_timeline: TimelinePoint[];
  movement_breakdown: MovementBreakdownRow[];
  weekly_consumption: WeeklyPoint[];
  consumption_trend: 'up' | 'down' | 'stable';
  purchase_price_trend: PriceTrendPoint[];
  purchase_pattern: PurchasePatternRow[];
  recipe_usage: RecipeUsageRow[];
  incoming_pos: IncomingPoRow[];
  production: ProductionRow[];
  transfers: TransferRow[];
  wastage: WastageRow[];
  opname: OpnameRow[];
  recent_movements: RecentMovementRow[];
}

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: ProductAnalyticsData | null; error: { message: string } | null }>;

export function useProductAnalytics(productId: string | null, days = 30) {
  return useQuery<ProductAnalyticsData | null>({
    queryKey: ['product-analytics', productId, days] as const,
    enabled: productId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      if (productId === null) return null;
      const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
      const { data, error } = await rpc('get_product_analytics_v1', {
        p_product_id: productId, p_days: days,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
  });
}
