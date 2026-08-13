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
  /**
   * Lot 6c — quantité déjà remboursée sur cette ligne (somme des refund_lines.qty
   * de tous les remboursements de la commande). Sert de plafond à la modale de
   * refund BO : on ne rembourse jamais plus que `quantity − qty_already_refunded`.
   */
  qty_already_refunded: number;
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

export interface OrderPromotionRow {
  description: string;
  name: string | null;
  amount: number;
}

export interface OrderDetail {
  id: string;
  order_number: string;
  status: string;
  order_type: string;
  table_number: string | null;
  created_at: string;
  paid_at: string | null;
  /**
   * Horodatage d'envoi en cuisine. NULL = la commande n'a JAMAIS été envoyée au
   * KDS : `order_items.kitchen_status` y vaut alors son DEFAULT ('pending') sans
   * qu'aucun cuisinier ne l'ait jamais touché — l'afficher ferait lire « impayé »
   * là où il n'y a que l'absence de cycle cuisine (audit UX/UI 2026-08-13, lot 6a).
   */
  sent_to_kitchen_at: string | null;
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
  promotions: OrderPromotionRow[];
  /**
   * Lot 6c — montant déjà remboursé par méthode de règlement (somme des
   * refund_payments.amount). Alimente le plafond par tender de la modale de
   * refund BO (un tender ne peut excéder `payé − déjà remboursé` pour sa méthode).
   */
  refunded_by_method: Record<string, number>;
  /** Lot 6c — total déjà remboursé sur la commande (somme des refunds.total). */
  total_refunded: number;
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
          id, order_number, status, order_type, table_number, created_at, paid_at,
          sent_to_kitchen_at,
          customer_id, served_by,
          subtotal, discount_amount, tax_amount, total,
          customers(name),
          user_profiles!orders_served_by_fkey(full_name),
          order_items(id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers, is_cancelled, kitchen_status),
          order_payments(id, method, amount, cash_received, change_given, paid_at, reference),
          refunds(id, refund_number, total, reason, created_at, refunded_by, is_full_void, refund_lines(order_item_id, qty), refund_payments(method, amount)),
          promotion_applications(amount, description, promotions(name))
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
        table_number: string | null;
        created_at: string;
        paid_at: string | null;
        sent_to_kitchen_at: string | null;
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
        refunds: (OrderRefundRow & {
          refund_lines: { order_item_id: string; qty: number }[] | null;
          refund_payments: { method: string; amount: number }[] | null;
        })[];
        promotion_applications: { amount: number; description: string; promotions: { name: string } | null }[];
      };

      // Lot 6c — agrégation des remboursements antérieurs (miroir du hook POS
      // apps/pos/src/features/order-history/hooks/useOrderDetail) : qty déjà
      // remboursée par ligne + montant remboursé par méthode + total remboursé.
      const refundedQtyByItem = new Map<string, number>();
      const refundedByMethod: Record<string, number> = {};
      let totalRefunded = 0;
      for (const r of row.refunds ?? []) {
        totalRefunded += Number(r.total ?? 0);
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
      return {
        id: row.id,
        order_number: row.order_number,
        status: row.status,
        order_type: row.order_type,
        table_number: row.table_number,
        created_at: row.created_at,
        paid_at: row.paid_at,
        sent_to_kitchen_at: row.sent_to_kitchen_at ?? null,
        customer_id: row.customer_id,
        customer_name: row.customers?.name ?? null,
        served_by: row.served_by,
        served_by_name: row.user_profiles?.full_name ?? null,
        subtotal: Number(row.subtotal ?? 0),
        discount_amount: Number(row.discount_amount ?? 0),
        tax_amount: Number(row.tax_amount ?? 0),
        total: Number(row.total ?? 0),
        items: (row.order_items ?? []).map((it) => ({
          ...it,
          qty_already_refunded: refundedQtyByItem.get(it.id) ?? 0,
        })),
        // Review PR #367 : un embed PostgREST sans clause order est dans un
        // ordre NON SPÉCIFIÉ (l'index (order_id, created_at DESC) le rend même
        // vraisemblablement antichronologique). La frise et les cartes lisent
        // « premier »/« dernier » — on trie ici, une fois, pour tout le monde.
        payments: [...(row.order_payments ?? [])].sort(
          (a, b) => new Date(a.paid_at).getTime() - new Date(b.paid_at).getTime(),
        ),
        refunds: [...(row.refunds ?? [])].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
        promotions: (row.promotion_applications ?? []).map((pa) => ({
          description: pa.description,
          name: pa.promotions?.name ?? null,
          amount: Number(pa.amount),
        })),
        refunded_by_method: refundedByMethod,
        total_refunded: totalRefunded,
      };
    },
  });
}
