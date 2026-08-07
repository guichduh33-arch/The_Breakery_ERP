// apps/backoffice/src/features/dashboard/hooks/useDashboardOverview.ts
//
// Écran 1c — l'agrégat du dashboard « Today », câblé sur get_dashboard_overview_v2.
//
// L'enveloppe jsonb du RPC est typée à la main (le regen produit `Json`), même
// pattern que usePaymentsByMethod. Les types portent les DEUX réserves de source
// gravées dans la migration 20260806000001 :
//   · `gross_margin.basis` — la marge est calculée au coût COURANT, aucun coût
//     n'étant figé à la vente ; les comparaisons J-1/D-7 ne mesurent donc que
//     le mix et les prix. L'UI doit le dire.
//   · `cash_on_hand.is_derived` — le découpage tiroir/coffre est déduit, pas
//     mesuré, tant que le compte tiroir dédié n'existe pas.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

/** Un KPI et ses deux comparaisons. `null` = comparaison impossible (base à 0). */
export interface KpiDelta {
  value: number | null;
  vs_yesterday: number | null;
  vs_d7: number | null;
}

export interface GrossMarginKpi {
  value: number | null;
  vs_yesterday_pt: number | null;
  vs_d7_pt: number | null;
  /** Toujours 'current_cost_price' aujourd'hui — voir l'en-tête. */
  basis: string;
  /** Part du CA dont le produit a un cost_price. < 100 ⇒ marge partielle. */
  cost_coverage_pct: number | null;
}

export interface CashWallet {
  code: string;
  name: string;
  balance: number;
}

export interface CashOnHandKpi {
  value: number | null;
  drawer?: number;
  safe?: number;
  is_derived?: boolean;
  wallets: CashWallet[];
  /** Vrai quand le rôle n'a pas `accounting.cash.read`. */
  restricted?: boolean;
}

export interface DashboardKpis {
  net_revenue:  KpiDelta;
  orders:       KpiDelta;
  items_sold:   KpiDelta;
  avg_basket:   KpiDelta;
  gross_margin: GrossMarginKpi;
  cash_on_hand: CashOnHandKpi;
}

export interface RevenueDay    { date: string; net: number; prev_net: number | null }
export interface RevenueSummary{ total: number; prev_total: number; delta_pct: number | null }
export interface HourlyBucket  { hour: number; today: number; last_week: number }
export interface HourlyPeak    { from_hour: number; to_hour: number; share_pct: number }
export interface RevenueShare  { order_type: string; gross: number; order_count: number; share_pct: number | null }
export interface PaymentLine   { method: string; amount: number; count: number; share_pct: number | null }

export interface PaymentsBlock {
  lines: PaymentLine[];
  total: number;
  cash_expected_drawer: number;
}

export interface CostLine {
  account_code: string;
  account_name: string;
  family: 'cogs' | 'opex';
  amount: number;
  mom_delta_pct: number | null;
}

export interface CostMtd {
  cogs_total: number;
  opex_total: number;
  sales_mtd: number;
  cogs_pct_of_sales: number | null;
  opex_pct_of_sales: number | null;
  total: number;
  cost_per_basket: number | null;
  lines: CostLine[];
}

export interface DashboardOverview {
  kpis:                DashboardKpis;
  revenue_30d:         RevenueDay[];
  revenue_30d_summary: RevenueSummary;
  hourly_sales:        HourlyBucket[];
  hourly_peak:         HourlyPeak | null;
  revenue_share:       RevenueShare[];
  payments:            PaymentsBlock;
  cost_mtd:            CostMtd;
  generated_at:        string;
}

export type DashboardErrorKind = 'permission_denied' | 'unknown';

export function classifyDashboardError(e: unknown): DashboardErrorKind {
  const code = (e as { code?: string } | null)?.code;
  const msg  = e instanceof Error ? e.message : String(e);
  if (code === '42501' || /permission denied/i.test(msg)) return 'permission_denied';
  return 'unknown';
}

export const DASHBOARD_OVERVIEW_KEY = ['dashboard-overview-v2'] as const;

export function useDashboardOverview(enabled = true) {
  return useQuery<DashboardOverview, Error>({
    queryKey: DASHBOARD_OVERVIEW_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_dashboard_overview_v2');
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as unknown as DashboardOverview;
    },
    refetchInterval: 60_000,
    staleTime:       30_000,
    enabled,
  });
}
