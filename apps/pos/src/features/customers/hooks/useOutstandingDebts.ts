// apps/pos/src/features/customers/hooks/useOutstandingDebts.ts
//
// Session 14 — Phase 2.D — Fetches customers with unpaid orders (ardoise).
// Session 37 — C5 (DB-06) — the direct `orders` query with a
// `customer:customers(...)` embed is replaced by the SECURITY DEFINER RPC
// `get_pos_b2b_debts_v2`, which computes `due = total − Σ payments > 0`
// server-side over the same lookback window and survives the
// `customers.read` SELECT gate (the embed would silently resolve to NULL
// for POS roles once the gate is applied). Per-customer aggregation stays
// client-side, unchanged.
// Session 52 — P1.2 (C4) — bumped to `get_pos_b2b_debts_v3`: for B2B orders
// `paid` is now derived from the `b2b_payment_allocations` ledger (not
// `order_payments`, which B2B payments never populate), so the POS panel and
// the BackOffice AR views agree on outstanding. Retail ardoise unchanged.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const DEBT_LOOKBACK_DAYS = 180;

export interface OutstandingOrder {
  id: string;
  order_number: string;
  order_type: string;
  total: number;
  paid: number;
  due: number;
  created_at: string;
  days_old: number;
}

export interface OutstandingDebt {
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  credit_limit: number;
  credit_used: number;
  total_due: number;
  oldest_order_days: number;
  orders: OutstandingOrder[];
}

export function useOutstandingDebts() {
  return useQuery<OutstandingDebt[]>({
    queryKey: ['pos-outstanding-debts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_b2b_debts_v3', {
        p_lookback_days: DEBT_LOOKBACK_DAYS,
      });

      if (error) throw new Error(error.message);

      const rows = data ?? [];
      const now = Date.now();

      const byCustomer = new Map<string, OutstandingDebt>();

      for (const r of rows) {
        const due = Number(r.outstanding);
        if (due <= 0) continue;

        const created = new Date(r.created_at).getTime();
        const days = Math.max(0, Math.floor((now - created) / (1000 * 60 * 60 * 24)));

        const orderEntry: OutstandingOrder = {
          id: r.order_id,
          order_number: r.order_number,
          order_type: r.order_type,
          total: Number(r.total),
          paid: Number(r.paid),
          due,
          created_at: r.created_at,
          days_old: days,
        };

        const existing = byCustomer.get(r.customer_id);
        if (existing) {
          existing.total_due += due;
          existing.orders.push(orderEntry);
          if (days > existing.oldest_order_days) existing.oldest_order_days = days;
        } else {
          byCustomer.set(r.customer_id, {
            customer_id: r.customer_id,
            customer_name: r.customer_name,
            customer_phone: r.customer_phone ?? null,
            credit_limit: Number(r.b2b_credit_limit ?? 0),
            credit_used: Number(r.b2b_current_balance ?? 0),
            total_due: due,
            oldest_order_days: days,
            orders: [orderEntry],
          });
        }
      }

      return Array.from(byCustomer.values()).sort((a, b) => b.oldest_order_days - a.oldest_order_days);
    },
    staleTime: 30_000,
  });
}
