// apps/backoffice/src/features/suppliers/hooks/useSupplierPurchases.ts
//
// Session 14 — Phase 5.A — Read-only purchase orders for one supplier.
// Drives the Purchases tab on SupplierDetailPage. We embed the line item count
// so the table can show "items" without a second round-trip.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type SupplierPORow = Database['public']['Tables']['purchase_orders']['Row'];

export interface SupplierPOListRow extends SupplierPORow {
  /** Aggregated count of line items (PostgREST head:count style). */
  item_count: number;
}

export const SUPPLIER_PURCHASES_QUERY_KEY = ['supplier-purchases'] as const;

export function useSupplierPurchases(supplierId: string | undefined) {
  return useQuery<SupplierPOListRow[]>({
    queryKey: [...SUPPLIER_PURCHASES_QUERY_KEY, supplierId ?? ''] as const,
    enabled: supplierId !== undefined && supplierId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      if (supplierId === undefined || supplierId === '') return [];
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(id)')
        .eq('supplier_id', supplierId)
        .is('deleted_at', null)
        .order('order_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      type RowWithItems = SupplierPORow & { purchase_order_items: { id: string }[] | null };
      const rows = (data ?? []) as unknown as RowWithItems[];
      return rows.map((r) => {
        const { purchase_order_items, ...rest } = r;
        return {
          ...rest,
          item_count: purchase_order_items?.length ?? 0,
        };
      });
    },
  });
}
