// apps/backoffice/src/features/inventory-opname/hooks/useOpnameDetail.ts
// Session 13 / Phase 2.D — single opname header + item rows.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { OpnameStatus } from './useOpnameList.js';

export interface OpnameItemRow {
  id:           string;
  product_id:   string;
  expected_qty: number;
  counted_qty:  number | null;
  variance:     number | null;
  unit:         string;
  notes:        string | null;
  movement_id:  string | null;
  product?:     { sku: string; name: string } | null;
}

export interface OpnameDetail {
  id:             string;
  count_number:   string;
  section_id:     string;
  status:         OpnameStatus;
  started_at:     string;
  finalized_at:   string | null;
  cancelled_at:   string | null;
  cancel_reason:  string | null;
  notes:          string | null;
  section?:       { code: string; name: string } | null;
  items:          OpnameItemRow[];
}

export const opnameDetailKey = (id: string | null) =>
  ['inventory-count', id ?? 'noop'] as const;

export function useOpnameDetail(countId: string | null) {
  return useQuery<OpnameDetail | null>({
    queryKey: opnameDetailKey(countId),
    enabled: countId !== null,
    staleTime: 5_000,
    queryFn: async () => {
      if (countId === null) return null;
      const { data: header, error: hErr } = await supabase
        .from('inventory_counts')
        .select('id, count_number, section_id, status, started_at, finalized_at, cancelled_at, cancel_reason, notes, section:sections(code, name)')
        .eq('id', countId)
        .single();
      if (hErr !== null) throw hErr;
      if (header === null) return null;

      const { data: items, error: iErr } = await supabase
        .from('inventory_count_items')
        .select('id, product_id, expected_qty, counted_qty, variance, unit, notes, movement_id, product:products(sku, name)')
        .eq('count_id', countId)
        .order('created_at', { ascending: true });
      if (iErr !== null) throw iErr;

      return {
        ...(header as unknown as Omit<OpnameDetail, 'items'>),
        items: (items as unknown as OpnameItemRow[]) ?? [],
      };
    },
  });
}
