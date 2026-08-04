// apps/backoffice/src/features/btob/hooks/useB2bDashboard.ts
//
// Session 24 / Phase 2.A.2 — aggregates for the B2B Dashboard page.
//
// Aging KPI now consumes the `view_ar_aging` view (S24 migration _012) which
// buckets unpaid B2B invoices on real invoice_date (created_at) rather than
// the previous `last_visit_at` proxy. Closes TASK-09-001 / TASK-09-006 and
// removes deviation D-W6-B2B-aging-bug.
//
// Order-side KPIs read `view_b2b_invoices` — the canonical B2B order surface
// (b2b customers, non-deleted, order_type='b2b', not voided). They used to be
// derived from a 50-row slice of `customers` ordered by `total_spent`: since
// that column is never maintained, the slice was arbitrary and every order
// outside it was invisible, so "Total orders" under-reported and
// "Active clients" was pinned at 0.
//
// Counts that must never under-report (`totalOrders`, `pendingOrders`) are
// server-side exact counts (`head: true`) — they transfer no rows, so no
// row cap can silently truncate them. Per-client rollups read one narrow
// projection and are aggregated here.

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

const CLIENT_COLS = [
  'id', 'name', 'b2b_company_name', 'b2b_current_balance', 'b2b_credit_limit',
].join(', ');

/** Narrow projection over `view_b2b_invoices` — one row per B2B invoice. */
const INVOICE_ROLLUP_COLS = 'customer_id, invoice_total, invoice_date';

const RECENT_ORDER_COLS =
  'invoice_id, order_number, invoice_total, order_status, invoice_date, customer_id';

interface InvoiceRollupRow {
  customer_id:   string | null;
  invoice_total: number | null;
  invoice_date:  string;
}

interface ClientRollup {
  orders:    number;
  spent:     number;
  lastOrder: string | null;
}

function startOfMonth(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
}

function startOfPrevMonth(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() - 1, 1);
}

type AgingBucketKey = 'current' | '31-60' | '61-90' | '90+';

interface ArAgingRow {
  customer_id:       string | null;
  bucket:            string | null;
  invoice_count:     number | null;
  total_outstanding: number | null;
  max_age_days:      number | null;
}

export function useB2bDashboard() {
  return useQuery<B2bDashboardData>({
    queryKey: B2B_DASHBOARD_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      // Every B2B client — no ranking slice, so no client can fall out of the
      // aggregates. Ordered by name only to make the payload deterministic.
      const { data: clients, error: cErr } = await supabase
        .from('customers')
        .select(CLIENT_COLS)
        .is('deleted_at', null)
        .eq('customer_type', 'b2b')
        .order('name', { ascending: true });
      if (cErr) throw cErr;
      const clientRows = (clients ?? []) as unknown as
        Omit<B2bClientRow, 'total_spent' | 'total_visits' | 'last_visit_at'>[];

      // Exact server-side counts — head:true transfers no rows.
      const { count: totalOrdersCount, error: tErr } = await supabase
        .from('view_b2b_invoices')
        .select('*', { count: 'exact', head: true });
      if (tErr) throw tErr;

      const { count: pendingCount, error: pErr } = await supabase
        .from('view_b2b_invoices')
        .select('*', { count: 'exact', head: true })
        .is('paid_at', null);
      if (pErr) throw pErr;

      const { data: rollupData, error: rErr } = await supabase
        .from('view_b2b_invoices')
        .select(INVOICE_ROLLUP_COLS);
      if (rErr) throw rErr;
      const rollupRows = (rollupData ?? []) as unknown as InvoiceRollupRow[];

      const monthStart = startOfMonth();
      const prevStart  = startOfPrevMonth();
      const perClient  = new Map<string, ClientRollup>();
      let monthly     = 0;
      let prevMonthly = 0;

      for (const row of rollupRows) {
        const total = Number(row.invoice_total ?? 0);
        const dated = new Date(row.invoice_date);
        if (dated >= monthStart) monthly += total;
        else if (dated >= prevStart && dated < monthStart) prevMonthly += total;

        if (row.customer_id === null) continue;
        const acc = perClient.get(row.customer_id)
          ?? { orders: 0, spent: 0, lastOrder: null };
        acc.orders += 1;
        acc.spent  += total;
        if (acc.lastOrder === null || row.invoice_date > acc.lastOrder) {
          acc.lastOrder = row.invoice_date;
        }
        perClient.set(row.customer_id, acc);
      }

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

      const pending    = pendingCount ?? 0;
      const totalCount = totalOrdersCount ?? 0;

      const monthlyDeltaPct = prevMonthly === 0
        ? (monthly === 0 ? 0 : 100)
        : Math.round(((monthly - prevMonthly) / prevMonthly) * 100);

      // Aging buckets — S24 : consume view_ar_aging (real invoice_date).
      const { data: agingRows, error: aErr } = await supabase
        .from('view_ar_aging')
        .select('customer_id, bucket, invoice_count, total_outstanding, max_age_days');
      if (aErr) throw aErr;

      const buckets: Record<AgingBucketKey, { count: number; total: number }> = {
        'current': { count: 0, total: 0 },
        '31-60':   { count: 0, total: 0 },
        '61-90':   { count: 0, total: 0 },
        '90+':     { count: 0, total: 0 },
      };
      let outstandingAr = 0;
      for (const row of (agingRows ?? []) as ArAgingRow[]) {
        const key = row.bucket as AgingBucketKey | null;
        if (key === null || !(key in buckets)) continue;
        const count = Number(row.invoice_count ?? 0);
        const total = Number(row.total_outstanding ?? 0);
        buckets[key].count += count;
        buckets[key].total += total;
        outstandingAr      += total;
      }

      const aging: B2bAgingBucket[] = [
        { label: 'Current', range: '0-30 days',   count: buckets.current.count,   total: buckets.current.total   },
        { label: 'Overdue', range: '31-60 days',  count: buckets['31-60'].count,  total: buckets['31-60'].total  },
        { label: 'Critical',range: '61-90 days',  count: buckets['61-90'].count,  total: buckets['61-90'].total  },
        { label: 'Default', range: '90+ days',    count: buckets['90+'].count,    total: buckets['90+'].total    },
      ];

      // "With at least one order" — counted on the orders themselves, not on
      // the `total_spent` cache, which no write path maintains.
      const activeClients = perClient.size;

      const enrichedClients: B2bClientRow[] = clientRows.map((c) => {
        const roll = perClient.get(c.id);
        return {
          ...c,
          total_spent:   roll?.spent     ?? 0,
          total_visits:  roll?.orders    ?? 0,
          last_visit_at: roll?.lastOrder ?? null,
        };
      });
      const topClients = enrichedClients
        .filter((c) => c.total_visits > 0)
        .sort((a, b) => b.total_spent - a.total_spent)
        .slice(0, 5);

      return {
        activeClients,
        monthlyRevenue: monthly,
        monthlyDeltaPct,
        outstandingAr,
        pendingOrders: pending,
        totalOrders: totalCount,
        topClients,
        recentOrders: recent,
        aging,
      };
    },
  });
}
