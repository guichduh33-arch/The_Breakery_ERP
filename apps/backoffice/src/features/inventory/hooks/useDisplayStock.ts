// apps/backoffice/src/features/inventory/hooks/useDisplayStock.ts
//
// POS display-stock isolation (Wave 6 / Task 25) — read-only BO view of the
// per-product "vitrine" counter (display_stock). RLS gates SELECT on
// `display.read` (BO admins have it). Pure read — display stock is mutated
// from the POS side only.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DisplayStockRow {
  product_id:   string;
  product_name: string;
  sku:          string;
  unit:         string;
  quantity:     number;
  updated_at:   string;
}

interface RawRow {
  quantity:   number;
  updated_at: string;
  // product:products(...) is a to-one embed → object (defensive: tolerate array).
  product: { id: string; name: string; sku: string; unit: string }
    | { id: string; name: string; sku: string; unit: string }[]
    | null;
}

export const DISPLAY_STOCK_QUERY_KEY = ['display-stock'] as const;

export function useDisplayStock() {
  return useQuery<DisplayStockRow[]>({
    queryKey: DISPLAY_STOCK_QUERY_KEY,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('display_stock')
        .select('quantity, updated_at, product:products(id, name, sku, unit)')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      const rows = (data ?? []) as unknown as RawRow[];
      return rows.map((r) => {
        const p = Array.isArray(r.product) ? r.product[0] : r.product;
        return {
          product_id:   p?.id ?? '',
          product_name: p?.name ?? '—',
          sku:          p?.sku ?? '',
          unit:         p?.unit ?? '',
          quantity:     Number(r.quantity),
          updated_at:   r.updated_at,
        };
      });
    },
  });
}
