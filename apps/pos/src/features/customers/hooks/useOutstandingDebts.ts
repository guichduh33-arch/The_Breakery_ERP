// apps/pos/src/features/customers/hooks/useOutstandingDebts.ts
//
// Session 14 — Phase 2.D — Fetches customers with unpaid orders (ardoise).
//
// Server-side strategy: pull orders with status='paid'/'pending_payment' that
// have remaining balance (subtotal - sum(payments) > 0). For Session 14 we
// keep it simple and use the existing schema:
//
//   1. List orders with status = 'pending_payment' (B2B credit / ardoise)
//   2. Aggregate by customer_id with sum(total)
//   3. Find oldest order date
//
// Idea: a future RPC `pos_outstanding_debts_v1` will collapse this. For
// now we do the client-side aggregation to avoid a schema/RPC change.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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

interface RawOrder {
  id: string;
  order_number: string;
  order_type: string;
  total: number;
  created_at: string;
  customer_id: string;
  status: string;
  order_payments: { amount: number }[] | null;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    b2b_credit_limit: number | null;
    b2b_current_balance: number;
  } | null;
}

export function useOutstandingDebts() {
  return useQuery<OutstandingDebt[]>({
    queryKey: ['pos-outstanding-debts'],
    queryFn: async () => {
      // Orders that are not voided and have an attached customer. We then
      // filter client-side to orders with positive remaining balance.
      const { data, error } = await supabase
        .from('orders')
        .select(
          'id, order_number, order_type, total, created_at, customer_id, status, order_payments(amount), customer:customers(id, name, phone, b2b_credit_limit, b2b_current_balance)',
        )
        .not('customer_id', 'is', null)
        .neq('status', 'voided')
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as unknown as RawOrder[];
      const now = Date.now();

      const byCustomer = new Map<string, OutstandingDebt>();

      for (const r of rows) {
        if (!r.customer) continue;
        const paid = (r.order_payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
        const total = Number(r.total);
        const due = total - paid;
        if (due <= 0) continue;

        const created = new Date(r.created_at).getTime();
        const days = Math.max(0, Math.floor((now - created) / (1000 * 60 * 60 * 24)));

        const orderEntry: OutstandingOrder = {
          id: r.id,
          order_number: r.order_number,
          order_type: r.order_type,
          total,
          paid,
          due,
          created_at: r.created_at,
          days_old: days,
        };

        const existing = byCustomer.get(r.customer.id);
        if (existing) {
          existing.total_due += due;
          existing.orders.push(orderEntry);
          if (days > existing.oldest_order_days) existing.oldest_order_days = days;
        } else {
          byCustomer.set(r.customer.id, {
            customer_id: r.customer.id,
            customer_name: r.customer.name,
            customer_phone: r.customer.phone,
            credit_limit: Number(r.customer.b2b_credit_limit ?? 0),
            credit_used: Number(r.customer.b2b_current_balance ?? 0),
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
