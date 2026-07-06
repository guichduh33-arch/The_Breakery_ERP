// apps/backoffice/src/features/dashboard/hooks/useDashboardOverview.ts
// S63 — hook du dashboard d'accueil : un seul RPC agrégé, pollé à 60 s.
// L'enveloppe jsonb du RPC est typée à la main (le regen produit `Json`),
// même pattern que usePaymentsByMethod.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DashboardKpis {
  revenue_today:   number;
  orders_today:    number;
  items_sold:      number;
  avg_basket:      number;
  customers_today: number;
}
export interface RevenueDay        { date: string; net: number; order_count: number }
export interface RevenueByType     { order_type: string; gross: number; order_count: number }
export interface TopProduct        { product_id: string; name: string; qty: number; revenue: number }
export interface HourlySale        { hour: number; gross: number; order_count: number }
export interface PaymentMethodLine { method: string; amount: number; count: number }

export interface DashboardOverview {
  kpis:            DashboardKpis;
  revenue_30d:     RevenueDay[];
  revenue_by_type: RevenueByType[];
  top_products:    TopProduct[];
  hourly_sales:    HourlySale[];
  payment_methods: PaymentMethodLine[];
  generated_at:    string;
}

export type DashboardErrorKind = 'permission_denied' | 'unknown';

export function classifyDashboardError(e: unknown): DashboardErrorKind {
  const code = (e as { code?: string } | null)?.code;
  const msg  = e instanceof Error ? e.message : String(e);
  if (code === '42501' || /permission denied/i.test(msg)) return 'permission_denied';
  return 'unknown';
}

export function useDashboardOverview(enabled = true) {
  return useQuery<DashboardOverview, Error>({
    queryKey: ['dashboard-overview'],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_dashboard_overview_v1');
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as unknown as DashboardOverview;
    },
    refetchInterval: 60_000,
    staleTime:       30_000,
    enabled,
  });
}
