// apps/pos/src/features/combos/hooks/useComboConfig.ts
//
// Session 47 — POS read-path hook for a single combo's choice-group definition.
// Mirrors the embed used in apps/backoffice/src/features/combos/hooks/useCombos.ts
// but returns a single ComboDefinition (for ONE combo product) rather than a list.
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ComboDefinition } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

// PostgREST may return an object or a singleton array for foreign-key embeds —
// the one() helper normalises both shapes to a nullable scalar.
function one<T>(v: T | T[] | null): T | null {
  if (v === null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
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

interface ComboRow {
  id: string;
  name: string;
  retail_price: number;
  combo_base_price: number | null;
  combo_groups: GroupRow[] | null;
}

export function useComboConfig(comboProductId: string): UseQueryResult<ComboDefinition> {
  return useQuery<ComboDefinition>({
    queryKey: ['combo-config', comboProductId],
    staleTime: 5 * 60_000,
    enabled: Boolean(comboProductId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, name, retail_price, combo_base_price, ' +
            'combo_groups ( id, name, group_type, is_required, min_select, max_select, sort_order, ' +
            'combo_group_options ( component_product_id, surcharge, is_default, sort_order, ' +
            'component:products!component_product_id ( name ) ) )',
        )
        .eq('id', comboProductId)
        .single();
      if (error) throw error;
      const row = data as unknown as ComboRow;

      const groupRows = [...(row.combo_groups ?? [])].sort((a, b) => a.sort_order - b.sort_order);
      const basePrice = Number(row.combo_base_price ?? row.retail_price);

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

      return {
        combo_product_id: row.id,
        name: row.name,
        base_price: basePrice,
        groups,
      };
    },
  });
}
