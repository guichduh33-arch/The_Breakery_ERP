// apps/pos/src/features/reports/hooks/usePOSReports.ts
//
// Session 14 — Phase 2.D — Aggregate POS reports for a period.
//
// One hook per surface to keep query keys narrow and avoid over-fetching:
//   - usePOSReportsOverview  → revenue, orders, avg basket, tax, sales-by-hour
//   - usePOSReportsProducts  → top products
//   - usePOSReportsActivity  → event timeline (sales + session opens/closes)
//
// All queries use Supabase via the existing `supabase` client. No new
// migrations or RPCs needed — these are read-only against existing tables.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ReportsPeriod } from './useReportsPeriod';

// ─── Overview ─────────────────────────────────────────────────────────────

export interface POSReportsOverview {
  revenue: number;
  orders: number;
  tax: number;
  avgBasket: number;
  salesByHour: { hour: number; total: number }[];
}

interface OverviewRow {
  total: number;
  tax_amount: number;
  paid_at: string | null;
}

export function usePOSReportsOverview(period: ReportsPeriod) {
  return useQuery<POSReportsOverview>({
    queryKey: ['pos-reports-overview', period.start, period.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('total, tax_amount, paid_at')
        .eq('status', 'paid')
        .gte('paid_at', period.start)
        .lt('paid_at', period.end);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as OverviewRow[];
      const revenue = rows.reduce((s, r) => s + Number(r.total), 0);
      const tax = rows.reduce((s, r) => s + Number(r.tax_amount), 0);
      const orders = rows.length;
      const avgBasket = orders > 0 ? revenue / orders : 0;

      const byHour = new Map<number, number>();
      for (let h = 6; h <= 23; h++) byHour.set(h, 0);
      for (const r of rows) {
        if (!r.paid_at) continue;
        const h = new Date(r.paid_at).getHours();
        byHour.set(h, (byHour.get(h) ?? 0) + Number(r.total));
      }
      const salesByHour = Array.from(byHour.entries())
        .sort(([a], [b]) => a - b)
        .map(([hour, total]) => ({ hour, total }));

      return { revenue, orders, tax, avgBasket, salesByHour };
    },
    staleTime: 30_000,
  });
}

// ─── Products ─────────────────────────────────────────────────────────────

export interface POSReportsTopProduct {
  product_id: string;
  product_name: string;
  qty: number;
  revenue: number;
}

interface ProductRow {
  product_id: string;
  name_snapshot: string;
  quantity: number;
  line_total: number;
  is_cancelled: boolean;
  order: { status: 'paid' | 'voided' | 'draft'; paid_at: string | null } | null;
}

export function usePOSReportsTopProducts(period: ReportsPeriod, limit = 25) {
  return useQuery<POSReportsTopProduct[]>({
    queryKey: ['pos-reports-top-products', period.start, period.end, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select(
          'product_id, name_snapshot, quantity, line_total, is_cancelled, order:orders!inner(status, paid_at)',
        )
        .eq('is_cancelled', false)
        .eq('order.status', 'paid')
        .gte('order.paid_at', period.start)
        .lt('order.paid_at', period.end);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as ProductRow[];
      const agg = new Map<string, POSReportsTopProduct>();
      for (const r of rows) {
        const existing = agg.get(r.product_id);
        if (existing) {
          existing.qty += Number(r.quantity);
          existing.revenue += Number(r.line_total);
        } else {
          agg.set(r.product_id, {
            product_id: r.product_id,
            product_name: r.name_snapshot,
            qty: Number(r.quantity),
            revenue: Number(r.line_total),
          });
        }
      }
      return Array.from(agg.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit);
    },
    staleTime: 30_000,
  });
}

// ─── Activity ─────────────────────────────────────────────────────────────

export type POSReportsEventKind = 'sale' | 'session_open' | 'session_close';

export interface POSReportsEvent {
  id: string;
  kind: POSReportsEventKind;
  reference: string;
  amount: number | null;
  at: string;
  label: string;
}

interface OrderActivityRow {
  id: string;
  order_number: string;
  total: number;
  paid_at: string | null;
}

interface SessionActivityRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
}

export function usePOSReportsActivity(period: ReportsPeriod) {
  return useQuery<POSReportsEvent[]>({
    queryKey: ['pos-reports-activity', period.start, period.end],
    queryFn: async () => {
      const [{ data: orderRows, error: orderErr }, { data: openSessions, error: openErr }, { data: closeSessions, error: closeErr }] =
        await Promise.all([
          supabase
            .from('orders')
            .select('id, order_number, total, paid_at')
            .eq('status', 'paid')
            .gte('paid_at', period.start)
            .lt('paid_at', period.end),
          supabase
            .from('pos_sessions')
            .select('id, opened_at, closed_at')
            .gte('opened_at', period.start)
            .lt('opened_at', period.end),
          supabase
            .from('pos_sessions')
            .select('id, opened_at, closed_at')
            .not('closed_at', 'is', null)
            .gte('closed_at', period.start)
            .lt('closed_at', period.end),
        ]);
      if (orderErr) throw new Error(orderErr.message);
      if (openErr) throw new Error(openErr.message);
      if (closeErr) throw new Error(closeErr.message);

      const events: POSReportsEvent[] = [];
      for (const r of (orderRows ?? []) as unknown as OrderActivityRow[]) {
        if (!r.paid_at) continue;
        events.push({
          id: `order-${r.id}`,
          kind: 'sale',
          reference: r.order_number,
          amount: Number(r.total),
          at: r.paid_at,
          label: 'Sale completed',
        });
      }
      for (const r of (openSessions ?? []) as unknown as SessionActivityRow[]) {
        events.push({
          id: `open-${r.id}`,
          kind: 'session_open',
          reference: `SHF-${r.id.slice(0, 6).toUpperCase()}`,
          amount: null,
          at: r.opened_at,
          label: 'Session opened',
        });
      }
      for (const r of (closeSessions ?? []) as unknown as SessionActivityRow[]) {
        if (!r.closed_at) continue;
        events.push({
          id: `close-${r.id}`,
          kind: 'session_close',
          reference: `SHF-${r.id.slice(0, 6).toUpperCase()}`,
          amount: null,
          at: r.closed_at,
          label: 'Session closed',
        });
      }
      events.sort((a, b) => (a.at < b.at ? 1 : -1));
      return events;
    },
    staleTime: 30_000,
  });
}
