// apps/backoffice/src/features/orders/hooks/useOrderDetail.ts
//
// Session 31 / Wave 2.B — Read-only order detail for /backoffice/orders/:id.
// PostgREST direct SELECT with embeds — no new RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface OrderItem {
  id: string;
  product_id: string;
  name_snapshot: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  modifiers: unknown;
  is_cancelled: boolean;
  kitchen_status: string | null;
}

export interface OrderPayment {
  id: string;
  method: string;
  amount: number;
  cash_received: number | null;
  change_given: number | null;
  paid_at: string;
  reference: string | null;
}

export interface OrderRefundRow {
  id: string;
  refund_number: string;
  total: number;
  reason: string;
  created_at: string;
  refunded_by: string | null;
  is_full_void: boolean;
}

export interface OrderDetail {
  id: string;
  order_number: string;
  status: string;
  order_type: string;
  created_at: string;
  paid_at: string | null;
  customer_id: string | null;
  customer_name: string | null;
  served_by: string | null;
  served_by_name: string | null;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  items: OrderItem[];
  payments: OrderPayment[];
  refunds: OrderRefundRow[];
}

export function useOrderDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['order-detail', id],
    enabled: !!id,
    queryFn: async (): Promise<OrderDetail> => {
      if (!id) throw new Error('id required');
      const { data, error } = await supabase
        .from('orders')
        .select(
          `
          id, order_number, status, order_type, created_at, paid_at,
          customer_id, served_by,
          subtotal, discount_amount, tax_amount, total,
          customers(name),
          user_profiles!orders_served_by_fkey(full_name),
          order_items(id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers, is_cancelled, kitchen_status),
          order_payments(id, method, amount, cash_received, change_given, paid_at, reference),
          refunds(id, refund_number, total, reason, created_at, refunded_by, is_full_void)
        `,
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      const row = data as unknown as {
        id: string;
        order_number: string;
        status: string;
        order_type: string;
        created_at: string;
        paid_at: string | null;
        customer_id: string | null;
        served_by: string | null;
        subtotal: number;
        discount_amount: number;
        tax_amount: number;
        total: number;
        customers: { name: string } | null;
        user_profiles: { full_name: string } | null;
        order_items: OrderItem[];
        order_payments: OrderPayment[];
        refunds: OrderRefundRow[];
      };
      return {
        id: row.id,
        order_number: row.order_number,
        status: row.status,
        order_type: row.order_type,
        created_at: row.created_at,
        paid_at: row.paid_at,
        customer_id: row.customer_id,
        customer_name: row.customers?.name ?? null,
        served_by: row.served_by,
        served_by_name: row.user_profiles?.full_name ?? null,
        subtotal: Number(row.subtotal ?? 0),
        discount_amount: Number(row.discount_amount ?? 0),
        tax_amount: Number(row.tax_amount ?? 0),
        total: Number(row.total ?? 0),
        items: row.order_items ?? [],
        payments: row.order_payments ?? [],
        refunds: row.refunds ?? [],
      };
    },
  });
}
