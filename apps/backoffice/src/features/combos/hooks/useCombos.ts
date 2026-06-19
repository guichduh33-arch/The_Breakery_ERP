// apps/backoffice/src/features/combos/hooks/useCombos.ts
//
// Session 47 — combos use the choice-group model (combo_groups +
// combo_group_options). Returns a list of Combo cards with groups (by name),
// priceRange (min→max via domain), and valuePrice (default-option sum).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { priceRange, valuePrice } from '@breakery/domain';
import type { ComboDefinition } from '@breakery/domain';
import type { Combo, ComboGroupSummary, ComboOptionSummary } from '../types.js';

interface OptionRow {
  component_product_id: string;
  surcharge: number;
  is_default: boolean;
  sort_order: number;
  component: { name: string; retail_price: number } | { name: string; retail_price: number }[] | null;
}

interface GroupRow {
  id: string;
  name: string;
  group_type: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  combo_group_options: OptionRow[] | null;
}

interface ComboRow {
  id: string;
  name: string;
  sku: string;
  combo_base_price: number | null;
  retail_price: number;
  is_active: boolean;
  image_url: string | null;
  combo_groups: GroupRow[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (v === null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function useCombos() {
  return useQuery<Combo[]>({
    queryKey: ['combos', 'list'] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, name, sku, retail_price, combo_base_price, is_active, image_url, ' +
            'combo_groups ( id, name, group_type, is_required, min_select, max_select, sort_order, ' +
            'combo_group_options ( component_product_id, surcharge, is_default, sort_order, component:products!component_product_id ( name, retail_price ) ) )',
        )
        .eq('product_type', 'combo')
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      const rows = (data ?? []) as unknown as ComboRow[];

      return rows.map((p) => {
        const groupRows = [...(p.combo_groups ?? [])].sort((a, b) => a.sort_order - b.sort_order);
        const basePrice = Number(p.combo_base_price ?? p.retail_price);

        // Build domain ComboDefinition to use priceRange + valuePrice helpers
        const defGroups: ComboDefinition['groups'] = groupRows.map((g) => {
          const opts = [...(g.combo_group_options ?? [])].sort((a, b) => a.sort_order - b.sort_order);
          return {
            id: g.id,
            name: g.name,
            group_type: (g.group_type as 'single' | 'multi') ?? 'single',
            is_required: g.is_required,
            min_select: g.min_select,
            max_select: g.max_select,
            sort_order: g.sort_order,
            options: opts.map((o) => ({
              id: o.component_product_id,
              component_product_id: o.component_product_id,
              label: one(o.component)?.name ?? '—',
              surcharge: Number(o.surcharge),
              is_default: o.is_default,
              sort_order: o.sort_order,
            })),
          };
        });

        const def: ComboDefinition = {
          combo_product_id: p.id,
          name: p.name,
          base_price: basePrice,
          groups: defGroups,
        };

        // Build componentRetail map for valuePrice
        const componentRetail: Record<string, number> = {};
        for (const g of groupRows) {
          for (const o of g.combo_group_options ?? []) {
            const comp = one(o.component);
            if (comp !== null) {
              componentRetail[o.component_product_id] = Number(comp.retail_price);
            }
          }
        }

        const range = priceRange(def);
        const vp = valuePrice(def, componentRetail);

        // Build card-level groups summary
        const groups: ComboGroupSummary[] = groupRows.map((g) => {
          const opts = [...(g.combo_group_options ?? [])].sort((a, b) => a.sort_order - b.sort_order);
          const options: ComboOptionSummary[] = opts.map((o) => ({
            component_product_id: o.component_product_id,
            label: one(o.component)?.name ?? '—',
            surcharge: Number(o.surcharge),
            is_default: o.is_default,
          }));
          return {
            id: g.id,
            name: g.name,
            group_type: (g.group_type as 'single' | 'multi') ?? 'single',
            is_required: g.is_required,
            min_select: g.min_select,
            max_select: g.max_select,
            options,
          };
        });

        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          retail_price: basePrice,
          value_price: vp,
          price_min: range.min,
          price_max: range.max,
          is_active: p.is_active,
          image_url: p.image_url,
          groups,
        } satisfies Combo;
      });
    },
  });
}
