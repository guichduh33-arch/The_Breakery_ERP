// apps/backoffice/src/features/combos/hooks/useCombos.ts
//
// Session 47 — combos now use the choice-group model (combo_groups +
// combo_group_options) instead of the dropped `combo_items` table. This lists
// combos with their groups (by name) for the management grid. Read-only.
//
// `retail_price` surfaces combo_base_price (the "Bundle Set Price"); `base_price`
// is the value anchor = Σ default-option component retail (the struck-through
// "Value Price"). The richer min→max range is layered on in the card (Wave C).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Combo, ComboCategoryGroup, ComboComponent } from '../types.js';

interface OptionRow {
  surcharge: number;
  is_default: boolean;
  sort_order: number;
  component: { name: string; retail_price: number } | { name: string; retail_price: number }[] | null;
}
interface GroupRow {
  id: string;
  name: string;
  sort_order: number;
  combo_group_options: OptionRow[] | null;
}
interface ComboRow {
  id: string;
  name: string;
  sku: string;
  retail_price: number;
  combo_base_price: number | null;
  is_active: boolean;
  image_url: string | null;
  combo_groups: GroupRow[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (v === null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
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
            'combo_groups ( id, name, sort_order, ' +
            'combo_group_options ( surcharge, is_default, sort_order, component:products!component_product_id ( name, retail_price ) ) )',
        )
        .eq('product_type', 'combo')
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      const rows = (data ?? []) as unknown as ComboRow[];

      return rows.map((p) => {
        const groupRows = [...(p.combo_groups ?? [])].sort((a, b) => a.sort_order - b.sort_order);
        let valuePrice = 0;
        const groups: ComboCategoryGroup[] = groupRows.map((g) => {
          const opts = [...(g.combo_group_options ?? [])].sort((a, b) => a.sort_order - b.sort_order);
          const components: ComboComponent[] = opts.map((o) => {
            const comp = one(o.component);
            return {
              product_id: '',
              product_name: comp?.name ?? '—',
              category_name: g.name,
              quantity: 1,
              sort_order: o.sort_order,
              upcharge: Number(o.surcharge),
            };
          });
          const def = opts.find((o) => o.is_default) ?? opts[0];
          if (def !== undefined) valuePrice += Number(one(def.component)?.retail_price ?? 0);
          return { category_name: g.name, components };
        });

        const base = Number(p.combo_base_price ?? p.retail_price);
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          retail_price: base,
          base_price: valuePrice,
          is_active: p.is_active,
          image_url: p.image_url,
          groups,
        } satisfies Combo;
      });
    },
  });
}
