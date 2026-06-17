// apps/backoffice/src/features/suppliers/hooks/useSupplierPurchaseItems.ts
//
// Read-only purchase-order LINE ITEMS for one supplier — powers the supplier
// detail Price Evolution + Analytics tabs (per-product price history, top
// products, monthly volume/spend). PostgREST inner-join filter on the parent
// purchase_orders.supplier_id, no new RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface SupplierPurchaseItem {
  po_id: string;
  po_number: string;
  order_date: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  subtotal: number;
}

export const SUPPLIER_PURCHASE_ITEMS_QUERY_KEY = ['supplier-purchase-items'] as const;

export function useSupplierPurchaseItems(supplierId: string | undefined) {
  return useQuery<SupplierPurchaseItem[]>({
    queryKey: [...SUPPLIER_PURCHASE_ITEMS_QUERY_KEY, supplierId ?? ''] as const,
    enabled: supplierId !== undefined && supplierId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      if (!supplierId) return [];
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select(
          'product_id, quantity, unit, unit_cost, subtotal, ' +
            'product:products(name), ' +
            'po:purchase_orders!inner(id, po_number, order_date, supplier_id, deleted_at)',
        )
        .eq('po.supplier_id', supplierId)
        .is('po.deleted_at', null);
      if (error) throw error;

      const rows = (data ?? []) as unknown as Array<{
        product_id: string;
        quantity: number;
        unit: string;
        unit_cost: number;
        subtotal: number | null;
        product: { name: string } | { name: string }[] | null;
        po: { id: string; po_number: string; order_date: string } | { id: string; po_number: string; order_date: string }[] | null;
      }>;

      return rows
        .map((r) => {
          const product = Array.isArray(r.product) ? r.product[0] : r.product;
          const po = Array.isArray(r.po) ? r.po[0] : r.po;
          if (!po) return null;
          return {
            po_id: po.id,
            po_number: po.po_number,
            order_date: po.order_date,
            product_id: r.product_id,
            product_name: product?.name ?? '—',
            quantity: Number(r.quantity),
            unit: r.unit,
            unit_cost: Number(r.unit_cost),
            subtotal: Number(r.subtotal ?? r.quantity * r.unit_cost),
          };
        })
        .filter((x): x is SupplierPurchaseItem => x !== null)
        .sort((a, b) => a.order_date.localeCompare(b.order_date));
    },
  });
}
