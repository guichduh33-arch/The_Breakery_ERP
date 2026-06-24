// apps/backoffice/src/features/purchasing/hooks/useHistoricalPurchasesExport.ts
// One-shot fetch of historical-import POs (is_historical_import=true), flattened to the
// import template column shape: one row per line item, po_reference = import_reference.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

const SELECT = `
  import_reference, order_date, payment_terms, notes,
  supplier:suppliers!inner(code),
  purchase_order_items(unit, quantity, unit_cost, product:products!inner(sku))
`.replace(/\s+/g, ' ').trim();

interface RawItem { unit: string; quantity: number; unit_cost: number; product: { sku: string } | { sku: string }[] | null }
interface RawRow {
  import_reference: string | null;
  order_date: string | null;
  payment_terms: string;
  notes: string | null;
  supplier: { code: string } | { code: string }[] | null;
  purchase_order_items: RawItem[];
}

function one<T extends object>(v: T | T[] | null): T | null {
  if (v === null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export function useHistoricalPurchasesExport() {
  return useMutation<Record<string, unknown>[], Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(SELECT)
        .eq('is_historical_import', true)
        .is('deleted_at', null)
        .order('order_date', { ascending: true });
      if (error !== null) throw new Error(error.message);
      const out: Record<string, unknown>[] = [];
      for (const po of (data ?? []) as unknown as RawRow[]) {
        const supplierCode = one(po.supplier)?.code ?? null;
        for (const it of po.purchase_order_items) {
          out.push({
            po_reference: po.import_reference,
            supplier_code: supplierCode,
            order_date: po.order_date,
            payment_terms: po.payment_terms,
            notes: po.notes,
            product_sku: one(it.product)?.sku ?? null,
            quantity: it.quantity,
            unit_cost: it.unit_cost,
            unit: it.unit,
          });
        }
      }
      return out;
    },
  });
}
