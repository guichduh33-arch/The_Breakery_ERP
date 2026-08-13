// apps/backoffice/src/features/btob/hooks/useB2bDashboard.ts
//
// ADR-026 — les agrégats du dashboard B2B quittent le client. Le hook lisait
// `view_b2b_invoices` EN ENTIER (sans pagination) et agrégeait en mémoire le
// revenu mensuel, la variation, le top clients et les clients actifs — la
// classe de défaut ADR-024 : un échantillon présenté comme un total, et des
// bornes de mois découpées dans le fuseau du navigateur.
//
// Tout agrégat vient désormais de la famille `get_b2b_dashboard_counters`
// (gate b2b.read, bornes de mois en fuseau métier, top clients bornés et triés
// serveur). Seule lecture de lignes restante : les 5 commandes récentes —
// bornée par construction, hors du principe.
//
// La réponse RPC est typée `Json` : on VALIDE la forme avant de s'en servir
// (un cast aveugle rend une page blanche, pas une erreur — leçon ~110 sites).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bClientRow {
  id:                  string;
  name:                string;
  b2b_company_name:    string | null;
  b2b_current_balance: number;
  b2b_credit_limit:    number | null;
  total_spent:         number;
  total_visits:        number;
  last_visit_at:       string | null;
}

export interface B2bRecentOrder {
  id:           string;
  order_number: string;
  total:        number;
  status:       string;
  created_at:   string;
  customer_id:  string | null;
}

export interface B2bAgingBucket {
  label: string;
  range: string;
  count: number;
  total: number;
}

export interface B2bDashboardData {
  activeClients:    number;
  monthlyRevenue:   number;
  monthlyDeltaPct:  number;
  outstandingAr:    number;
  pendingOrders:    number;
  totalOrders:      number;
  topClients:       B2bClientRow[];
  recentOrders:     B2bRecentOrder[];
  aging:            readonly B2bAgingBucket[];
}

export const B2B_DASHBOARD_QUERY_KEY = ['b2b-dashboard'] as const;

const RECENT_ORDER_COLS =
  'invoice_id, order_number, invoice_total, order_status, invoice_date, customer_id';

type AgingBucketKey = 'current' | '31-60' | '61-90' | '90+';

interface CountersPayload {
  active_clients:        number;
  monthly_revenue:       number;
  prev_monthly_revenue:  number;
  outstanding_ar:        number;
  pending_orders:        number;
  total_orders:          number;
  top_clients:           {
    id: string; name: string; b2b_company_name: string | null;
    b2b_current_balance: number; b2b_credit_limit: number | null;
    total_spent: number; total_visits: number; last_visit_at: string | null;
  }[];
  aging: Partial<Record<AgingBucketKey, { count: number; total: number }>>;
}

/** Garde de forme — jamais un cast aveugle sur une réponse `Json`. */
function assertCountersPayload(raw: unknown): CountersPayload {
  const p = raw as Partial<CountersPayload> | null;
  if (
    p === null || typeof p !== 'object' ||
    typeof p.active_clients !== 'number' ||
    typeof p.monthly_revenue !== 'number' ||
    typeof p.prev_monthly_revenue !== 'number' ||
    typeof p.outstanding_ar !== 'number' ||
    typeof p.pending_orders !== 'number' ||
    typeof p.total_orders !== 'number' ||
    !Array.isArray(p.top_clients) ||
    p.aging === null || typeof p.aging !== 'object'
  ) {
    throw new Error('get_b2b_dashboard_counters: unexpected payload shape');
  }
  return p as CountersPayload;
}

export function useB2bDashboard() {
  return useQuery<B2bDashboardData>({
    queryKey: B2B_DASHBOARD_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: countersRaw, error: cErr } = await supabase
        .rpc('get_b2b_dashboard_counters_v1');
      if (cErr) throw cErr;
      const counters = assertCountersPayload(countersRaw);

      const { data: recentData, error: oErr } = await supabase
        .from('view_b2b_invoices')
        .select(RECENT_ORDER_COLS)
        .order('invoice_date', { ascending: false })
        .limit(5);
      if (oErr) throw oErr;
      const recent: B2bRecentOrder[] = ((recentData ?? []) as unknown as {
        invoice_id: string; order_number: string; invoice_total: number | null;
        order_status: string; invoice_date: string; customer_id: string | null;
      }[]).map((o) => ({
        id:           o.invoice_id,
        order_number: o.order_number,
        total:        Number(o.invoice_total ?? 0),
        status:       o.order_status,
        created_at:   o.invoice_date,
        customer_id:  o.customer_id,
      }));

      const monthly     = counters.monthly_revenue;
      const prevMonthly = counters.prev_monthly_revenue;
      const monthlyDeltaPct = prevMonthly === 0
        ? (monthly === 0 ? 0 : 100)
        : Math.round(((monthly - prevMonthly) / prevMonthly) * 100);

      const bucket = (key: AgingBucketKey): { count: number; total: number } =>
        counters.aging[key] ?? { count: 0, total: 0 };
      const aging: B2bAgingBucket[] = [
        { label: 'Current',  range: '0-30 days',  ...bucket('current') },
        { label: 'Overdue',  range: '31-60 days', ...bucket('31-60')   },
        { label: 'Critical', range: '61-90 days', ...bucket('61-90')   },
        { label: 'Default',  range: '90+ days',   ...bucket('90+')     },
      ];

      const topClients: B2bClientRow[] = counters.top_clients.map((c) => ({
        id:                  c.id,
        name:                c.name,
        b2b_company_name:    c.b2b_company_name,
        b2b_current_balance: Number(c.b2b_current_balance),
        b2b_credit_limit:    c.b2b_credit_limit === null ? null : Number(c.b2b_credit_limit),
        total_spent:         Number(c.total_spent),
        total_visits:        Number(c.total_visits),
        last_visit_at:       c.last_visit_at,
      }));

      return {
        activeClients:  counters.active_clients,
        monthlyRevenue: monthly,
        monthlyDeltaPct,
        outstandingAr:  counters.outstanding_ar,
        pendingOrders:  counters.pending_orders,
        totalOrders:    counters.total_orders,
        topClients,
        recentOrders:   recent,
        aging,
      };
    },
  });
}
