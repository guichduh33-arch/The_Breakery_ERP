// apps/backoffice/src/features/products/hooks/useProductPurchaseItems.ts
//
// Read-only purchase-order LINE ITEMS for ONE product — powers the product
// detail "Purchase" tab (last purchase transactions: supplier, PO, date, qty,
// unit price, total, receipt status). PostgREST inner-join filter on the parent
// purchase_orders.product_id, no new RPC. Mirrors useSupplierPurchaseItems but
// keyed on product_id and embedding the supplier name.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductPurchaseItem {
  po_id:             string;
  po_number:         string;
  order_date:        string;
  status:            string;
  received_date:     string | null;
  supplier_name:     string;
  quantity:          number;
  received_quantity: number;
  unit:              string;
  unit_cost:         number;
  subtotal:          number;
}

export const PRODUCT_PURCHASE_ITEMS_QUERY_KEY = ['product-purchase-items'] as const;

export function useProductPurchaseItems(productId: string | null) {
  return useQuery<ProductPurchaseItem[]>({
    queryKey: [...PRODUCT_PURCHASE_ITEMS_QUERY_KEY, productId ?? ''] as const,
    enabled: productId !== null && productId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      if (productId === null || productId === '') return [];
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select(
          'quantity, received_quantity, unit, unit_cost, subtotal, ' +
            'po:purchase_orders!inner(id, po_number, order_date, status, received_date, ' +
            'deleted_at, supplier:suppliers(name))',
        )
        .eq('product_id', productId)
        .is('po.deleted_at', null);
      if (error) throw error;

      type Po = {
        id: string;
        po_number: string;
        order_date: string;
        status: string;
        received_date: string | null;
        supplier: { name: string } | { name: string }[] | null;
      };
      const rows = (data ?? []) as unknown as Array<{
        quantity: number;
        received_quantity: number;
        unit: string;
        unit_cost: number;
        subtotal: number | null;
        po: Po | Po[] | null;
      }>;

      return rows
        .map((r) => {
          const po = Array.isArray(r.po) ? r.po[0] : r.po;
          if (!po) return null;
          const supplier = Array.isArray(po.supplier) ? po.supplier[0] : po.supplier;
          return {
            po_id:             po.id,
            po_number:         po.po_number,
            order_date:        po.order_date,
            status:            po.status,
            received_date:     po.received_date,
            supplier_name:     supplier?.name ?? '—',
            quantity:          Number(r.quantity),
            received_quantity: Number(r.received_quantity),
            unit:              r.unit,
            unit_cost:         Number(r.unit_cost),
            subtotal:          Number(r.subtotal ?? r.quantity * r.unit_cost),
          };
        })
        .filter((x): x is ProductPurchaseItem => x !== null)
        // Most recent purchase first.
        .sort((a, b) => b.order_date.localeCompare(a.order_date));
    },
  });
}
