// apps/backoffice/src/features/inventory-production/hooks/useProductionRecords.ts
//
// Lists production_records (most recent first). Optional date-range filter.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductionRecordSummary {
  id: string;
  production_number: string;
  product_id: string;
  product_name?: string;
  quantity_produced: number;
  quantity_waste: number;
  production_date: string;
  section_id: string | null;
  batch_number: string | null;
  materials_consumed: boolean;
  stock_updated: boolean;
  je_posted: boolean;
  reverted_at: string | null;
  notes: string | null;
}

export interface ProductionRecordsFilter {
  fromDate?: string;
  toDate?:   string;
  productId?: string;
}

export function useProductionRecords(filter: ProductionRecordsFilter = {}) {
  return useQuery<ProductionRecordSummary[]>({
    queryKey: ['inventory-production', 'records', filter] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<ProductionRecordSummary[]> => {
      let q = supabase
        .from('production_records')
        .select('id, production_number, product_id, quantity_produced, quantity_waste, production_date, section_id, batch_number, materials_consumed, stock_updated, je_posted, reverted_at, notes')
        .order('production_date', { ascending: false })
        .limit(200);
      if (filter.fromDate) q = q.gte('production_date', filter.fromDate);
      if (filter.toDate)   q = q.lte('production_date', filter.toDate);
      if (filter.productId) q = q.eq('product_id', filter.productId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];

      // Resolve product names in a second pass (avoid PostgREST relation typing).
      const productIds = Array.from(new Set(rows.map((r) => r.product_id)));
      const nameById: Record<string, string> = {};
      if (productIds.length > 0) {
        const { data: prods, error: prodErr } = await supabase
          .from('products')
          .select('id, name')
          .in('id', productIds);
        if (prodErr) throw prodErr;
        for (const p of prods ?? []) {
          nameById[p.id as string] = p.name as string;
        }
      }

      return rows.map((r): ProductionRecordSummary => {
        const base: ProductionRecordSummary = {
          id: r.id,
          production_number: r.production_number,
          product_id: r.product_id,
          quantity_produced: Number(r.quantity_produced),
          quantity_waste: Number(r.quantity_waste),
          production_date: r.production_date,
          section_id: r.section_id,
          batch_number: r.batch_number,
          materials_consumed: r.materials_consumed,
          stock_updated: r.stock_updated,
          je_posted: r.je_posted,
          reverted_at: r.reverted_at,
          notes: r.notes,
        };
        const name = nameById[r.product_id];
        if (name !== undefined) base.product_name = name;
        return base;
      });
    },
  });
}
