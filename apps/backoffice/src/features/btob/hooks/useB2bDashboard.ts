// apps/backoffice/src/features/btob/hooks/useB2bDashboard.ts
//
// Session 14 / Phase 5.B — aggregates for the B2B Dashboard page.
//
// SCOPE: B2B-specific tables (b2b_orders / b2b_payments / aging buckets) do
// not exist in the V3 schema. We approximate the dashboard from the existing
// `customers` table (b2b filter) + `orders` joined on `customer_id`. This is
// READ-ONLY: + New B2B Order / + New Payment buttons are disabled with a
// tooltip explaining the gap. Tracked as deviation D-W6-B2B-01 for Session
// 15+ when proper B2B order RPCs are in scope.

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
  aging:            ReadonlyArray<B2bAgingBucket>;
}

export const B2B_DASHBOARD_QUERY_KEY = ['b2b-dashboard'] as const;

const CLIENT_COLS = [
  'id', 'name', 'b2b_company_name', 'b2b_current_balance', 'b2b_credit_limit',
  'total_spent', 'total_visits', 'last_visit_at',
].join(', ');

function startOfMonth(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
}

function startOfPrevMonth(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() - 1, 1);
}

function ageBuckets(days: number): 'current' | '31-60' | '61-90' | '90+' {
  if (days <= 30) return 'current';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function useB2bDashboard() {
  return useQuery<B2bDashboardData>({
    queryKey: B2B_DASHBOARD_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: clients, error: cErr } = await supabase
        .from('customers')
        .select(CLIENT_COLS)
        .is('deleted_at', null)
        .eq('customer_type', 'b2b')
        .order('total_spent', { ascending: false })
        .limit(50);
      if (cErr) throw cErr;
      const clientRows = (clients ?? []) as unknown as B2bClientRow[];

      const ids = clientRows.map((c) => c.id);
      let recent: B2bRecentOrder[] = [];
      let monthly = 0;
      let prevMonthly = 0;
      let pending = 0;
      let totalCount = 0;

      if (ids.length > 0) {
        const { data: orders, error: oErr } = await supabase
          .from('orders')
          .select('id, order_number, total, status, created_at, customer_id, paid_at')
          .in('customer_id', ids)
          .order('created_at', { ascending: false })
          .limit(200);
        if (oErr) throw oErr;
        const orderRows = (orders ?? []) as Array<{
          id: string; order_number: string; total: number; status: string;
          created_at: string; customer_id: string | null; paid_at: string | null;
        }>;
        const monthStart = startOfMonth();
        const prevStart  = startOfPrevMonth();
        for (const o of orderRows) {
          totalCount += 1;
          const created = new Date(o.created_at);
          if (created >= monthStart) monthly += Number(o.total);
          else if (created >= prevStart && created < monthStart) prevMonthly += Number(o.total);
          if (o.status === 'pending' || o.status === 'open' || o.paid_at === null) pending += 1;
        }
        recent = orderRows.slice(0, 5).map((o) => ({
          id: o.id, order_number: o.order_number, total: Number(o.total),
          status: o.status, created_at: o.created_at, customer_id: o.customer_id,
        }));
      }

      const monthlyDeltaPct = prevMonthly === 0
        ? (monthly === 0 ? 0 : 100)
        : Math.round(((monthly - prevMonthly) / prevMonthly) * 100);

      // Aging buckets — use last_visit_at as a proxy invoice date for unpaid balance.
      const buckets: Record<'current' | '31-60' | '61-90' | '90+', { count: number; total: number }> = {
        'current': { count: 0, total: 0 },
        '31-60':   { count: 0, total: 0 },
        '61-90':   { count: 0, total: 0 },
        '90+':     { count: 0, total: 0 },
      };
      let outstandingAr = 0;
      for (const c of clientRows) {
        const bal = Number(c.b2b_current_balance ?? 0);
        if (bal <= 0) continue;
        outstandingAr += bal;
        const ageDays = c.last_visit_at === null
          ? 0
          : Math.floor((Date.now() - new Date(c.last_visit_at).getTime()) / 86_400_000);
        const k = ageBuckets(ageDays);
        buckets[k].count += 1;
        buckets[k].total += bal;
      }

      const aging: B2bAgingBucket[] = [
        { label: 'Current', range: '0-30 days',   count: buckets.current.count,   total: buckets.current.total   },
        { label: 'Overdue', range: '31-60 days',  count: buckets['31-60'].count,  total: buckets['31-60'].total  },
        { label: 'Critical',range: '61-90 days',  count: buckets['61-90'].count,  total: buckets['61-90'].total  },
        { label: 'Default', range: '90+ days',    count: buckets['90+'].count,    total: buckets['90+'].total    },
      ];

      const activeClients = clientRows.filter((c) => Number(c.total_spent ?? 0) > 0).length;

      return {
        activeClients,
        monthlyRevenue: monthly,
        monthlyDeltaPct,
        outstandingAr,
        pendingOrders: pending,
        totalOrders: totalCount,
        topClients: clientRows.slice(0, 5),
        recentOrders: recent,
        aging,
      };
    },
  });
}
