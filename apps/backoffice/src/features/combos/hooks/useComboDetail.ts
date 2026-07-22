// apps/backoffice/src/features/combos/hooks/useComboDetail.ts
//
// Session 47 — fetches a single combo's full ComboDefinition + general-info
// fields for the builder editor. Enabled when comboId is truthy.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { ComboDefinition } from '@breakery/domain';

export interface ComboDetailMeta {
  combo_product_id: string;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
  category_id: string | null;
  base_price: number;
  display_order: number;
  is_active: boolean;
  visible_on_pos: boolean;
  definition: ComboDefinition;
}

interface OptionRow {
  component_product_id: string;
  surcharge: number;
  is_default: boolean;
  sort_order: number;
  component: { name: string } | { name: string }[] | null;
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

interface ComboDetailRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
  category_id: string | null;
  combo_base_price: number | null;
  retail_price: number;
  combo_display_order: number | null;
  is_active: boolean;
  visible_on_pos: boolean;
  combo_groups: GroupRow[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (v === null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function useComboDetail(comboId: string | undefined) {
  return useQuery<ComboDetailMeta | null>({
    queryKey: ['combos', 'detail', comboId] as const,
    enabled: comboId !== undefined && comboId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      if (!comboId) return null;
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, sku, name, description, image_url, category_id, combo_base_price, retail_price, ' +
            'combo_display_order, is_active, visible_on_pos, ' +
            'combo_groups ( id, name, group_type, is_required, min_select, max_select, sort_order, ' +
            'combo_group_options ( component_product_id, surcharge, is_default, sort_order, component:products!component_product_id ( name ) ) )',
        )
        .eq('id', comboId)
        .eq('product_type', 'combo')
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as ComboDetailRow;

      const basePrice = Number(row.combo_base_price ?? row.retail_price);
      const groupRows = [...(row.combo_groups ?? [])].sort((a, b) => a.sort_order - b.sort_order);

      const groups: ComboDefinition['groups'] = groupRows.map((g) => {
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

      const definition: ComboDefinition = {
        combo_product_id: row.id,
        name: row.name,
        base_price: basePrice,
        groups,
      };

      return {
        combo_product_id: row.id,
        sku: row.sku,
        name: row.name,
        description: row.description,
        image_url: row.image_url,
        category_id: row.category_id,
        base_price: basePrice,
        display_order: row.combo_display_order ?? 0,
        is_active: row.is_active,
        visible_on_pos: row.visible_on_pos,
        definition,
      };
    },
  });
}
