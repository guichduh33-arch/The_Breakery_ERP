// apps/backoffice/src/features/suppliers/hooks/useSupplierPurchases.ts
//
// Session 14 — Phase 5.A — Read-only purchase orders for one supplier.
// Drives the Purchases tab on SupplierDetailPage. We embed the line item count
// so the table can show "items" without a second round-trip.
// S3-07 — on embarque aussi `purchase_payments(amount)` : le badge de paiement
// de chaque ligne se dérive du grand livre, jamais du statut du bon.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';
import { sumPayments } from '../utils/supplierOutstanding.js';

export type SupplierPORow = Database['public']['Tables']['purchase_orders']['Row'];

export interface SupplierPOListRow extends SupplierPORow {
  /** Aggregated count of line items (PostgREST head:count style). */
  item_count: number;
  /** Σ purchase_payments.amount pour ce bon (grand livre, 0 si aucun). */
  paid_amount: number;
}

export const SUPPLIER_PURCHASES_QUERY_KEY = ['supplier-purchases'] as const;
export const SUPPLIER_PURCHASES_LIMIT = 1000;

export function useSupplierPurchases(supplierId: string | undefined) {
  return useQuery<SupplierPOListRow[]>({
    queryKey: [...SUPPLIER_PURCHASES_QUERY_KEY, supplierId ?? ''] as const,
    enabled: supplierId !== undefined && supplierId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      if (supplierId === undefined || supplierId === '') return [];
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(id), purchase_payments(amount)')
        .eq('supplier_id', supplierId)
        .is('deleted_at', null)
        .order('order_date', { ascending: false })
        // 1 000 = le plafond de PostgREST. À 100, l'onglet, ses filtres et les
        // tuiles « Total Spent » / « Purchase Orders » ignoraient en silence
        // les bons plus anciens ; l'onglet dit maintenant quand le plafond est
        // atteint (SUPPLIER_PURCHASES_LIMIT).
        .limit(SUPPLIER_PURCHASES_LIMIT);
      if (error) throw error;
      type RowWithItems = SupplierPORow & {
        purchase_order_items: { id: string }[] | null;
        purchase_payments:    { amount: number | string | null }[] | null;
      };
      const rows = (data ?? []) as unknown as RowWithItems[];
      return rows.map((r) => {
        const { purchase_order_items, purchase_payments, ...rest } = r;
        return {
          ...rest,
          item_count:  purchase_order_items?.length ?? 0,
          paid_amount: sumPayments(purchase_payments),
        };
      });
    },
  });
}
