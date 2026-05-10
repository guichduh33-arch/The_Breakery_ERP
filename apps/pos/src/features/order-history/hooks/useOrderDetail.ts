// apps/pos/src/features/order-history/hooks/useOrderDetail.ts
//
// Session 10 — fetch a single order with items + payments + prior refunds for
// the OrderDetailDrawer / VoidOrderModal / RefundOrderModal flows.

import { useQuery } from '@tanstack/react-query';
import type { PaymentMethod } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export interface OrderDetailItem {
  id: string;
  product_id: string;
  name_snapshot: string;
  quantity: number;
  line_total: number;
  is_cancelled: boolean;
  qty_already_refunded: number;
}

export interface OrderDetailPayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
}

export interface OrderDetail {
  id: string;
  order_number: string;
  status: 'paid' | 'voided' | 'draft';
  total: number;
  tax_amount: number;
  customer_id: string | null;
  table_number: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  items: OrderDetailItem[];
  payments: OrderDetailPayment[];
  /** Per-method already-refunded for this order (sum of refund_payments). */
  refunded_by_method: Partial<Record<PaymentMethod, number>>;
  total_refunded: number;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface SelectBuilder {
  eq: (col: string, val: unknown) => SelectBuilder;
  single: () => Promise<QueryResult<unknown>>;
  maybeSingle: () => Promise<QueryResult<unknown>>;
}
interface LooseFromBuilder {
  select: (cols: string) => SelectBuilder;
}
interface LooseSupabase {
  from: (table: string) => LooseFromBuilder;
}
const sb = supabase as unknown as LooseSupabase;

interface RawDetail {
  id: string;
  order_number: string;
  status: 'paid' | 'voided' | 'draft';
  total: number;
  tax_amount: number;
  customer_id: string | null;
  table_number: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  order_items: Array<{
    id: string;
    product_id: string;
    name_snapshot: string;
    quantity: number;
    line_total: number;
    is_cancelled: boolean;
  }>;
  order_payments: Array<{
    id: string;
    method: PaymentMethod;
    amount: number;
    reference: string | null;
  }>;
  refunds: Array<{
    total: number;
    refund_lines: Array<{ order_item_id: string; qty: number }>;
    refund_payments: Array<{ method: PaymentMethod; amount: number }>;
  }>;
}

export function useOrderDetail(orderId: string | null) {
  return useQuery<OrderDetail | null>({
    queryKey: ['order-detail', orderId],
    queryFn: async (): Promise<OrderDetail | null> => {
      if (!orderId) return null;
      const { data, error } = await sb
        .from('orders')
        .select(
          `id, order_number, status, total, tax_amount, customer_id, table_number,
           paid_at, voided_at, void_reason,
           order_items(id, product_id, name_snapshot, quantity, line_total, is_cancelled),
           order_payments(id, method, amount, reference),
           refunds(total, refund_lines(order_item_id, qty), refund_payments(method, amount))`,
        )
        .eq('id', orderId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return null;
      const raw = data as unknown as RawDetail;

      // Aggregate prior refunds → per-line refunded qty + per-method refunded amount.
      const refundedQtyByItem = new Map<string, number>();
      const refundedByMethod: Partial<Record<PaymentMethod, number>> = {};
      let total_refunded = 0;
      for (const r of raw.refunds ?? []) {
        total_refunded += Number(r.total);
        for (const ln of r.refund_lines ?? []) {
          refundedQtyByItem.set(
            ln.order_item_id,
            (refundedQtyByItem.get(ln.order_item_id) ?? 0) + Number(ln.qty),
          );
        }
        for (const rp of r.refund_payments ?? []) {
          refundedByMethod[rp.method] = (refundedByMethod[rp.method] ?? 0) + Number(rp.amount);
        }
      }

      const items = (raw.order_items ?? []).map((it) => ({
        id: it.id,
        product_id: it.product_id,
        name_snapshot: it.name_snapshot,
        quantity: Number(it.quantity),
        line_total: Number(it.line_total),
        is_cancelled: Boolean(it.is_cancelled),
        qty_already_refunded: refundedQtyByItem.get(it.id) ?? 0,
      }));

      const payments = (raw.order_payments ?? []).map((p) => ({
        id: p.id,
        method: p.method,
        amount: Number(p.amount),
        reference: p.reference,
      }));

      return {
        id: raw.id,
        order_number: raw.order_number,
        status: raw.status,
        total: Number(raw.total),
        tax_amount: Number(raw.tax_amount),
        customer_id: raw.customer_id,
        table_number: raw.table_number,
        paid_at: raw.paid_at,
        voided_at: raw.voided_at,
        void_reason: raw.void_reason,
        items,
        payments,
        refunded_by_method: refundedByMethod,
        total_refunded,
      };
    },
    enabled: Boolean(orderId),
    staleTime: 5_000,
  });
}
