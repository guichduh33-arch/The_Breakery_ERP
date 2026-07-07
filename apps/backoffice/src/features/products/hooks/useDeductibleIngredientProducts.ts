// apps/backoffice/src/features/products/hooks/useDeductibleIngredientProducts.ts
//
// Products selectable as `ingredients_to_deduct` on a modifier option: raw
// materials (categories.category_type='raw_material') ∪ semi-finished products
// (products.is_semi_finished). The server resolver
// `_resolve_modifier_ingredients_v1` deducts any product_id, so the picker —
// not the money-path — was the only thing keeping SFG out of modifier extras.
// PostgREST cannot OR a product-level flag with a joined-category filter, so
// the two populations are fetched in parallel and merged (dedup by id).
//
// Rows are structurally a `ModifierCostMaterial` (cost_price + unitOptions) so
// the picker's material-cost display keeps working — SFG cost_price is the
// production WAC.
//
// Spec: docs/superpowers/specs/2026-07-07-modifier-extras-sfg-ingredients-design.md

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DeductibleUnitOption {
  code:   string;
  factor: number;   // factor_to_base (base unit = 1)
}

export interface DeductibleIngredientRow {
  id:               string;
  sku:              string;
  name:             string;
  unit:             string;          // base unit
  cost_price:       number | null;
  unitOptions:      DeductibleUnitOption[];  // base ∪ alternatives (ordered)
  is_semi_finished: boolean;
}

export const DEDUCTIBLE_INGREDIENTS_QUERY_KEY = [
  'deductible-ingredient-products',
] as const;

interface RawAltRow { code: string; factor_to_base: number | string; display_order: number }
interface RawProductRow {
  id:         string;
  sku:        string;
  name:       string;
  unit:       string;
  cost_price: number | null;
  product_unit_alternatives: RawAltRow[] | null;
}

const SELECT_COLUMNS =
  'id, sku, name, unit, cost_price, ' +
  'product_unit_alternatives(code, factor_to_base, display_order)';

function buildUnitOptions(base: string, alts: RawAltRow[] | null): DeductibleUnitOption[] {
  const out: DeductibleUnitOption[] = [{ code: base, factor: 1 }];
  const ordered = (alts ?? []).slice().sort((a, b) => a.display_order - b.display_order);
  for (const a of ordered) {
    if (a.code === base) continue; // base already present
    if (out.some((o) => o.code === a.code)) continue;
    out.push({ code: a.code, factor: Number(a.factor_to_base) });
  }
  return out;
}

function toRow(p: RawProductRow, isSemiFinished: boolean): DeductibleIngredientRow {
  return {
    id:               p.id,
    sku:              p.sku,
    name:             p.name,
    unit:             p.unit,
    cost_price:       p.cost_price,
    unitOptions:      buildUnitOptions(p.unit, p.product_unit_alternatives),
    is_semi_finished: isSemiFinished,
  };
}

export function useDeductibleIngredientProducts() {
  return useQuery<DeductibleIngredientRow[]>({
    queryKey: DEDUCTIBLE_INGREDIENTS_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const [raw, semi] = await Promise.all([
        supabase
          .from('products')
          .select(`${SELECT_COLUMNS}, categories!inner(category_type)`)
          .eq('categories.category_type', 'raw_material')
          .is('deleted_at', null)
          .eq('is_active', true)
          .order('name')
          .limit(1000),
        supabase
          .from('products')
          .select(SELECT_COLUMNS)
          .eq('is_semi_finished', true)
          .is('deleted_at', null)
          .eq('is_active', true)
          .order('name')
          .limit(1000),
      ]);
      if (raw.error) throw raw.error;
      if (semi.error) throw semi.error;

      const byId = new Map<string, DeductibleIngredientRow>();
      for (const p of (raw.data ?? []) as unknown as RawProductRow[]) {
        byId.set(p.id, toRow(p, false));
      }
      // Semi-finished wins on overlap so the picker groups it as SFG.
      for (const p of (semi.data ?? []) as unknown as RawProductRow[]) {
        byId.set(p.id, toRow(p, true));
      }
      return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}
