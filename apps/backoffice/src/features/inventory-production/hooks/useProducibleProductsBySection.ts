// apps/backoffice/src/features/inventory-production/hooks/useProducibleProductsBySection.ts
//
// Products that can be produced AT a given production station (section). Strict
// filter: a product appears only if it is linked to the section via
// product_sections AND is an active finished/semi-finished product AND has an
// active recipe. Each product carries its unit options (base unit first, then
// product_unit_alternatives) so the Production entry rows can offer a unit
// selector and convert the entered quantity to the base unit before submit.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { getOperationalProducts } from '@/lib/operationalProducts.js';

export interface ProducibleUnitOption {
  code: string;
  /** Multiply a quantity in this unit by factor_to_base to get the base unit. */
  factor_to_base: number;
}

export interface ProducibleProduct {
  id: string;
  sku: string;
  name: string;
  /** Base (stock) unit — conversions and the RPC quantity are in this unit. */
  unit: string;
  product_type: string;
  current_stock: number | null;
  /** Base unit first, then any alternative units. */
  units: ProducibleUnitOption[];
}

export const producibleBySectionKey = (sectionId: string) =>
  ['inventory-production', 'producible-by-section', sectionId] as const;

export function useProducibleProductsBySection(sectionId: string | null) {
  return useQuery<ProducibleProduct[]>({
    queryKey: producibleBySectionKey(sectionId ?? ''),
    enabled: sectionId !== null && sectionId !== '',
    staleTime: 60_000,
    queryFn: async (): Promise<ProducibleProduct[]> => {
      // 1. product ids linked to this station.
      const { data: links, error: linkErr } = await supabase
        .from('product_sections')
        .select('product_id')
        .eq('section_id', sectionId!);
      if (linkErr) throw linkErr;
      const linkedIds = Array.from(new Set((links ?? []).map((l) => l.product_id)));
      if (linkedIds.length === 0) return [];

      // 2. producible products among them.
      const linked = new Set(linkedIds);
      const prodRows = (await getOperationalProducts())
        .filter((p) => linked.has(p.id) && ['finished', 'semi_finished'].includes(p.product_type)
          && p.is_active && p.deleted_at === null)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (prodRows.length === 0) return [];
      const prodIds = prodRows.map((p) => p.id);

      // 3. active recipes → only products that can actually be produced.
      const { data: recs, error: recErr } = await supabase
        .from('recipes')
        .select('product_id')
        .in('product_id', prodIds)
        .eq('is_active', true)
        .is('deleted_at', null);
      if (recErr) throw recErr;
      const withRecipe = new Set((recs ?? []).map((r) => r.product_id));

      // 4. alternative units (base unit is added first, below).
      const { data: alts, error: altErr } = await supabase
        .from('product_unit_alternatives')
        .select('product_id, code, factor_to_base, display_order')
        .in('product_id', prodIds)
        .is('deleted_at', null)
        .order('display_order');
      if (altErr) throw altErr;
      const altsByProduct = new Map<string, ProducibleUnitOption[]>();
      for (const a of alts ?? []) {
        const pid = a.product_id;
        const list = altsByProduct.get(pid) ?? [];
        list.push({ code: a.code, factor_to_base: Number(a.factor_to_base) });
        altsByProduct.set(pid, list);
      }

      return prodRows
        .filter((p) => withRecipe.has(p.id))
        .map((p): ProducibleProduct => {
          const base: ProducibleUnitOption = { code: p.unit, factor_to_base: 1 };
          const extra = (altsByProduct.get(p.id) ?? []).filter((u) => u.code !== p.unit);
          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            unit: p.unit,
            product_type: p.product_type,
            current_stock: p.current_stock,
            units: [base, ...extra],
          };
        });
    },
  });
}
