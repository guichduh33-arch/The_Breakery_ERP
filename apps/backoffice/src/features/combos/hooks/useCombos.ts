// apps/backoffice/src/features/combos/hooks/useCombos.ts
//
// Session 14 / Phase 4.B — List combos with their components grouped by
// category. Read-only — write paths arrive when the combo CRUD RPCs ship.
//
// The query joins:
//   products (where product_type='combo')   -> parent rows
//   combo_items                              -> link rows
//   products (component side) + categories   -> component metadata
//
// We deliberately stay within plain Supabase reads (no RPC) since this is a
// read-only listing surface.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Combo, ComboCategoryGroup, ComboComponent } from '../types.js';

interface ComboParentRow {
  id:           string;
  name:         string;
  sku:          string;
  retail_price: number;
  is_active:    boolean;
  image_url:    string | null;
}

interface ComboItemRow {
  parent_product_id:   string;
  component_product_id: string;
  quantity:            number;
  sort_order:          number;
}

interface ComponentRow {
  id:           string;
  name:         string;
  retail_price: number;
  cost_price:   number;
  category_id:  string;
  categories:   { name: string } | { name: string }[] | null;
}

export function useCombos() {
  return useQuery<Combo[]>({
    queryKey: ['combos', 'list'] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: parents, error: parentsErr } = await supabase
        .from('products')
        .select('id, name, sku, retail_price, is_active, image_url')
        .eq('product_type', 'combo')
        .is('deleted_at', null)
        .order('name');
      if (parentsErr) throw parentsErr;
      const parentRows = (parents ?? []) as ComboParentRow[];
      if (parentRows.length === 0) return [];

      const parentIds = parentRows.map((p) => p.id);

      const { data: items, error: itemsErr } = await supabase
        .from('combo_items')
        .select('parent_product_id, component_product_id, quantity, sort_order')
        .in('parent_product_id', parentIds)
        .order('sort_order');
      if (itemsErr) throw itemsErr;
      const itemRows = (items ?? []) as ComboItemRow[];

      const componentIds = Array.from(new Set(itemRows.map((i) => i.component_product_id)));
      let componentRows: ComponentRow[] = [];
      if (componentIds.length > 0) {
        const { data: comps, error: compsErr } = await supabase
          .from('products')
          .select('id, name, retail_price, cost_price, category_id, categories:categories ( name )')
          .in('id', componentIds);
        if (compsErr) throw compsErr;
        componentRows = (comps ?? []) as ComponentRow[];
      }
      const componentById = new Map(componentRows.map((c) => [c.id, c]));

      const itemsByParent = new Map<string, ComboItemRow[]>();
      for (const it of itemRows) {
        const list = itemsByParent.get(it.parent_product_id) ?? [];
        list.push(it);
        itemsByParent.set(it.parent_product_id, list);
      }

      return parentRows.map((p) => {
        const links = itemsByParent.get(p.id) ?? [];
        const components: ComboComponent[] = links.map((l) => {
          const c = componentById.get(l.component_product_id);
          const categoryName = c === undefined
            ? null
            : Array.isArray(c.categories)
              ? c.categories[0]?.name ?? null
              : c.categories?.name ?? null;
          return {
            product_id:    l.component_product_id,
            product_name:  c?.name ?? '—',
            category_name: categoryName,
            quantity:      Number(l.quantity),
            sort_order:    l.sort_order,
            upcharge:      0,
          };
        });

        const base = components.reduce((acc, comp) => {
          const c = componentById.get(comp.product_id);
          if (c === undefined) return acc;
          return acc + Number(c.retail_price) * comp.quantity;
        }, 0);

        const groups: ComboCategoryGroup[] = groupByCategory(components);

        return {
          id:           p.id,
          name:         p.name,
          sku:          p.sku,
          retail_price: Number(p.retail_price),
          base_price:   base,
          is_active:    p.is_active,
          image_url:    p.image_url,
          groups,
        } satisfies Combo;
      });
    },
  });
}

function groupByCategory(components: ReadonlyArray<ComboComponent>): ComboCategoryGroup[] {
  const map = new Map<string, ComboComponent[]>();
  for (const c of components) {
    const key = c.category_name ?? 'Other';
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([name, list]) => ({
    category_name: name,
    components:    list,
  }));
}
