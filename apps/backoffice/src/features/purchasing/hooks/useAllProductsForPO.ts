// apps/backoffice/src/features/purchasing/hooks/useAllProductsForPO.ts
//
// Session 13 — Phase 3.A — list of products used by the PO line-item editor.
// Session 46 — R1: restricted to RAW-MATERIAL products only
// (categories.category_type='raw_material', inner-join filter — NOT the SKU badge).
// Session 46 — R2: each product carries its valid purchase units (base unit ∪
// product_unit_alternatives) + the default purchase unit (product_unit_contexts).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PoUnitOption {
  code:   string;
  factor: number;   // factor_to_base (base unit = 1)
}

export interface PoProductRow {
  id:                  string;
  sku:                 string;
  name:                string;
  unit:                string;          // base unit
  cost_price:          number | null;
  unitOptions:         PoUnitOption[];  // base ∪ alternatives (ordered)
  defaultPurchaseUnit: string;          // purchase_unit context, else base unit
}

export const PO_PRODUCTS_QUERY_KEY = ['po-products', 'raw-material'] as const;

interface RawAltRow { code: string; factor_to_base: number | string; display_order: number }
interface RawCtxRow { purchase_unit: string }
interface RawProductRow {
  id:         string;
  sku:        string;
  name:       string;
  unit:       string;
  cost_price: number | null;
  product_unit_alternatives: RawAltRow[] | null;
  product_unit_contexts:     RawCtxRow | RawCtxRow[] | null;
}

function buildUnitOptions(base: string, alts: RawAltRow[] | null): PoUnitOption[] {
  const out: PoUnitOption[] = [{ code: base, factor: 1 }];
  const ordered = (alts ?? []).slice().sort((a, b) => a.display_order - b.display_order);
  for (const a of ordered) {
    if (a.code === base) continue; // base already present
    if (out.some((o) => o.code === a.code)) continue;
    out.push({ code: a.code, factor: Number(a.factor_to_base) });
  }
  return out;
}

export function useAllProductsForPO() {
  return useQuery<PoProductRow[]>({
    queryKey: PO_PRODUCTS_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, sku, name, unit, cost_price, ' +
          'categories!inner(category_type), ' +
          'product_unit_alternatives(code, factor_to_base, display_order), ' +
          'product_unit_contexts(purchase_unit)'
        )
        .eq('categories.category_type', 'raw_material')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name')
        .limit(1000);
      if (error) throw error;

      return ((data ?? []) as unknown as RawProductRow[]).map((p) => {
        const ctx = Array.isArray(p.product_unit_contexts)
          ? p.product_unit_contexts[0]
          : p.product_unit_contexts;
        const unitOptions = buildUnitOptions(p.unit, p.product_unit_alternatives);
        const defaultPurchaseUnit =
          ctx?.purchase_unit && unitOptions.some((o) => o.code === ctx.purchase_unit)
            ? ctx.purchase_unit
            : p.unit;
        return {
          id:         p.id,
          sku:        p.sku,
          name:       p.name,
          unit:       p.unit,
          cost_price: p.cost_price,
          unitOptions,
          defaultPurchaseUnit,
        };
      });
    },
  });
}
