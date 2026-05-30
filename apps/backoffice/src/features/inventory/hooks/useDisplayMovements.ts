// apps/backoffice/src/features/inventory/hooks/useDisplayMovements.ts
//
// POS display-stock isolation (Wave 6 / Task 25) — read-only BO view of the
// display_movements append-only ledger (last 200). RLS gates SELECT on
// `display.read`. Pure read — movements are recorded from the POS side only.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type DisplayMovementType =
  | 'stock_in'
  | 'sale'
  | 'return_to_kitchen'
  | 'waste'
  | 'adjustment';

export interface DisplayMovementRow {
  id:             string;
  product_name:   string;
  movement_type:  DisplayMovementType;
  quantity:       number;
  reason:         string | null;
  reference_type: string | null;
  created_at:     string;
}

interface RawRow {
  id:             string;
  movement_type:  DisplayMovementType;
  quantity:       number;
  reason:         string | null;
  reference_type: string | null;
  created_at:     string;
  // product:products(name) is a to-one embed → object (defensive: tolerate array).
  product: { name: string } | { name: string }[] | null;
}

export const DISPLAY_MOVEMENTS_QUERY_KEY = ['display-movements'] as const;

export function useDisplayMovements() {
  return useQuery<DisplayMovementRow[]>({
    queryKey: DISPLAY_MOVEMENTS_QUERY_KEY,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('display_movements')
        .select('id, movement_type, quantity, reason, reference_type, created_at, product:products(name)')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      const rows = (data ?? []) as unknown as RawRow[];
      return rows.map((r) => {
        const p = Array.isArray(r.product) ? r.product[0] : r.product;
        return {
          id:             r.id,
          product_name:   p?.name ?? '—',
          movement_type:  r.movement_type,
          quantity:       Number(r.quantity),
          reason:         r.reason,
          reference_type: r.reference_type,
          created_at:     r.created_at,
        };
      });
    },
  });
}
