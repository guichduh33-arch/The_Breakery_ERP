// apps/backoffice/src/features/purchasing/hooks/usePurchaseOrderDetail.ts
//
// Session 13 — Phase 3.A — fetches a single PO with its line items + GRNs.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type PurchaseOrderRow      = Database['public']['Tables']['purchase_orders']['Row'];
export type PurchaseOrderItemRow  = Database['public']['Tables']['purchase_order_items']['Row'];
export type GoodsReceiptNoteRow   = Database['public']['Tables']['goods_receipt_notes']['Row'];

export interface PurchaseOrderItemDetail extends PurchaseOrderItemRow {
  products: { sku: string; name: string; unit: string } | null;
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  suppliers: { code: string; name: string; payment_terms_days: number } | null;
  purchase_order_items: PurchaseOrderItemDetail[];
  goods_receipt_notes: GoodsReceiptNoteRow[];
}

export const PURCHASE_ORDER_DETAIL_QUERY_KEY = ['purchase-order-detail'] as const;

export function usePurchaseOrderDetail(id: string | undefined) {
  return useQuery<PurchaseOrderDetail | null>({
    queryKey: [...PURCHASE_ORDER_DETAIL_QUERY_KEY, id] as const,
    enabled:  id !== undefined && id !== '',
    staleTime: 15_000,
    queryFn: async () => {
      if (id === undefined || id === '') return null;
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(
          '*, ' +
          'suppliers(code, name, payment_terms_days), ' +
          'purchase_order_items(*, products(sku, name, unit)), ' +
          'goods_receipt_notes(*)'
        )
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error !== null) throw error;
      return data as unknown as PurchaseOrderDetail | null;
    },
  });
}
