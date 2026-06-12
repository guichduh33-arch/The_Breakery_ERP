// apps/backoffice/src/features/inventory-dashboard/hooks/useProductDashboard.ts
// Session 13 / Phase 2.D — get_product_dashboard_v1 wrapper.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductDashboardData {
  product: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    cost_price: number;
    retail_price: number;
    current_stock: number;
    min_stock_threshold: number;
    value_at_cost: number;
  };
  summary: {
    window_days: number;
    units_sold: number;
    avg_daily_units: number;
    last_movement_at: string | null;
  };
  stock_by_section: Array<{
    section_id: string;
    section_code: string;
    section_name: string;
    quantity: number;
    unit: string;
    value_at_cost: number;
  }>;
  recent_movements: Array<{
    id: string;
    movement_type: string;
    quantity: number;
    unit: string;
    reason: string | null;
    from_section_code: string | null;
    to_section_code: string | null;
    created_at: string;
  }>;
  sales_velocity_daily: Array<{
    day: string;
    units_sold: number;
  }>;
  expiring_lots: Array<{
    id: string;
    quantity: number;
    unit: string;
    expires_at: string;
    batch_number: string | null;
    status: string;
    hours_until_expiry: number;
  }>;
  top_customers: Array<{
    customer_id: string;
    customer_name: string;
    units_bought: number;
    spend_total: number;
  }>;
}

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: ProductDashboardData | null; error: { message: string } | null }>;

export function useProductDashboard(productId: string | null, days = 30) {
  return useQuery<ProductDashboardData | null>({
    queryKey: ['product-dashboard', productId, days] as const,
    enabled: productId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      if (productId === null) return null;
      const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
      const { data, error } = await rpc('get_product_dashboard_v1', {
        p_product_id: productId, p_days: days,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
  });
}
