// apps/backoffice/src/features/customers/hooks/useCustomerAnalytics.ts
//
// Per-customer purchase analytics — powers the Analytics tab of the customer
// detail page. Aggregated client-side from the customer's own orders +
// order_items (read-only PostgREST, no new RPC). Counts only realised-revenue
// orders (completed / paid), matching the dashboard's revenue semantics.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

const REVENUE_STATUSES = ['completed', 'paid'] as const;

export type AnalyticsOrderType = 'dine_in' | 'take_out' | 'delivery' | 'b2b';

export interface MonthlySpendPoint {
  month: string; // 'YYYY-MM'
  label: string; // 'Jun'
  total: number;
  orders: number;
}

export interface OrderTypeSlice {
  type: AnalyticsOrderType;
  label: string;
  orders: number;
  total: number;
}

export interface TopProduct {
  product_id: string;
  name: string;
  quantity: number;
  spend: number;
}

export interface CustomerAnalytics {
  ordersConsidered: number;
  totalSpend: number;
  avgBasket: number;
  monthly: MonthlySpendPoint[];
  byType: OrderTypeSlice[];
  topProducts: TopProduct[];
}

const TYPE_LABELS: Record<AnalyticsOrderType, string> = {
  dine_in: 'Dine-in',
  take_out: 'Take-out',
  delivery: 'Delivery',
  b2b: 'B2B',
};

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const customerAnalyticsKey = (customerId: string | null | undefined) =>
  ['customer-analytics', customerId] as const;

export function useCustomerAnalytics(customerId: string | null | undefined) {
  return useQuery<CustomerAnalytics>({
    queryKey: customerAnalyticsKey(customerId),
    enabled: !!customerId,
    staleTime: 60_000,
    queryFn: async (): Promise<CustomerAnalytics> => {
      const empty: CustomerAnalytics = {
        ordersConsidered: 0,
        totalSpend: 0,
        avgBasket: 0,
        monthly: [],
        byType: [],
        topProducts: [],
      };
      if (!customerId) return empty;

      const { data: orders, error } = await supabase
        .from('orders')
        .select('id, created_at, total, order_type, status')
        .eq('customer_id', customerId)
        .in('status', REVENUE_STATUSES as unknown as ('completed' | 'paid')[])
        .order('created_at', { ascending: true });
      if (error) throw error;

      const rows = orders ?? [];
      if (rows.length === 0) return empty;

      // ---- Monthly trend over the last 12 months (always 12 buckets) --------
      const now = new Date();
      const buckets: MonthlySpendPoint[] = [];
      const keyToIdx = new Map<string, number>();
      for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        keyToIdx.set(key, buckets.length);
        buckets.push({ month: key, label: MONTH_LABELS[d.getMonth()] ?? '', total: 0, orders: 0 });
      }

      // ---- Order-type split + totals ---------------------------------------
      const typeAgg = new Map<AnalyticsOrderType, { orders: number; total: number }>();
      let totalSpend = 0;
      for (const o of rows) {
        const total = Number(o.total);
        totalSpend += total;
        const k = o.created_at.slice(0, 7);
        const idx = keyToIdx.get(k);
        if (idx !== undefined) {
          const bucket = buckets[idx];
          if (bucket) {
            bucket.total += total;
            bucket.orders += 1;
          }
        }
        const t = o.order_type as AnalyticsOrderType;
        const prev = typeAgg.get(t) ?? { orders: 0, total: 0 };
        typeAgg.set(t, { orders: prev.orders + 1, total: prev.total + total });
      }

      const byType: OrderTypeSlice[] = (
        ['dine_in', 'take_out', 'delivery', 'b2b'] as AnalyticsOrderType[]
      )
        .map((type) => ({
          type,
          label: TYPE_LABELS[type],
          orders: typeAgg.get(type)?.orders ?? 0,
          total: typeAgg.get(type)?.total ?? 0,
        }))
        .filter((s) => s.orders > 0);

      // ---- Top products (across those orders) ------------------------------
      const orderIds = rows.map((o) => o.id);
      const { data: items, error: itErr } = await supabase
        .from('order_items')
        .select('product_id, name_snapshot, quantity, line_total')
        .in('order_id', orderIds)
        .eq('is_cancelled', false);
      if (itErr) throw itErr;

      const prodAgg = new Map<string, TopProduct>();
      for (const it of items ?? []) {
        const pid = it.product_id ?? it.name_snapshot;
        const prev =
          prodAgg.get(pid) ??
          { product_id: pid, name: it.name_snapshot, quantity: 0, spend: 0 };
        prev.quantity += Number(it.quantity);
        prev.spend += Number(it.line_total);
        prodAgg.set(pid, prev);
      }
      const topProducts = Array.from(prodAgg.values())
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 6);

      return {
        ordersConsidered: rows.length,
        totalSpend,
        avgBasket: rows.length > 0 ? Math.round(totalSpend / rows.length) : 0,
        monthly: buckets,
        byType,
        topProducts,
      };
    },
  });
}
