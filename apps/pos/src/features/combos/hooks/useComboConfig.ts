// apps/pos/src/features/combos/hooks/useComboConfig.ts
//
// Session 47 — POS read-path hook for a single combo's choice-group definition.
// Mirrors the embed used in apps/backoffice/src/features/combos/hooks/useCombos.ts
// but returns a single ComboDefinition (for ONE combo product) rather than a list.
//
// ADR-017 — the definition now also carries, per option, the modifier groups of
// the COMPONENT behind it. They are fetched in a second round-trip (the combo
// embed cannot reach product_modifiers) and folded with the same `mergeGroups`
// helper the à-la-carte path uses, so a component behaves in a combo exactly as
// it does when sold alone — product scope first, category scope as fallback.
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  mergeGroups,
  type ComboDefinition,
  type ModifierGroup,
  type ProductModifierRow,
} from '@breakery/domain';
import { supabase } from '@/lib/supabase';

// PostgREST may return an object or a singleton array for foreign-key embeds —
// the one() helper normalises both shapes to a nullable scalar.
function one<T>(v: T | T[] | null): T | null {
  if (v === null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface ComponentRef {
  name: string;
  category_id: string | null;
  // ADR-022 déc. 3.2 — colonnes de vendabilité, lues pour écarter côté client ce
  // que la RPC refuse côté serveur (déc. 1).
  is_active: boolean;
  deleted_at: string | null;
}

interface OptionRow {
  component_product_id: string;
  surcharge: number;
  is_default: boolean;
  sort_order: number;
  component: ComponentRef | ComponentRef[] | null;
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

const MODIFIER_COLUMNS =
  'id, product_id, category_id, group_name, group_sort_order, group_required, group_type, option_label, option_icon, option_sort_order, price_adjustment, is_default, is_active';

/**
 * Minimal builder shape — `product_modifiers` is not part of the generated
 * Database types (same caveat as useProductModifiers).
 */
interface ModifierQueryBuilder {
  from(table: string): {
    select(columns: string): {
      or(filter: string): {
        eq(column: string, value: unknown): {
          is(column: string, value: unknown): Promise<{
            data: ProductModifierRow[] | null;
            error: Error | null;
          }>;
        };
      };
    };
  };
}

/**
 * Fetch every modifier row reachable by the given components, then fold them per
 * component. A component keeps only the rows scoped to itself, plus the rows
 * scoped to its category for the groups it does not already define — the exact
 * precedence `mergeGroups` applies for an à-la-carte product.
 */
async function fetchComponentModifierGroups(
  components: { product_id: string; category_id: string | null }[],
): Promise<Record<string, ModifierGroup[]>> {
  if (components.length === 0) return {};

  const productIds = components.map((c) => c.product_id);
  const categoryIds = [...new Set(components.map((c) => c.category_id).filter((c): c is string => c !== null))];

  const orParts = [`product_id.in.(${productIds.join(',')})`];
  if (categoryIds.length > 0) orParts.push(`category_id.in.(${categoryIds.join(',')})`);

  const client = supabase as unknown as ModifierQueryBuilder;
  const { data, error } = await client
    .from('product_modifiers')
    .select(MODIFIER_COLUMNS)
    .or(orParts.join(','))
    .eq('is_active', true)
    .is('deleted_at', null);

  if (error) throw error;
  const rows = data ?? [];

  const byComponent: Record<string, ModifierGroup[]> = {};
  for (const comp of components) {
    const own = rows.filter((r) => r.product_id === comp.product_id);
    const viaCategory = comp.category_id === null
      ? []
      : rows.filter((r) => r.product_id === null && r.category_id === comp.category_id);
    const groups = mergeGroups([...own, ...viaCategory]);
    if (groups.length > 0) byComponent[comp.product_id] = groups;
  }
  return byComponent;
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
            'component:products!component_product_id ( name, category_id, is_active, deleted_at ) ) )',
        )
        .eq('id', comboProductId)
        .single();
      if (error) throw error;
      const row = data as unknown as ComboRow;

      const groupRows = [...(row.combo_groups ?? [])].sort((a, b) => a.sort_order - b.sort_order);
      const basePrice = Number(row.combo_base_price ?? row.retail_price);

      // ADR-022 déc. 3.2 — la garde de vendabilité vit AUSSI côté client, avec
      // les MÊMES critères que la RPC, au moment où la ligne entre au panier.
      // Le configurateur proposait jusqu'ici des composants désactivés,
      // soft-deleted ou parents d'un groupe de variantes : la RPC les refuse
      // désormais (déc. 1), et rien ne doit pouvoir entrer au panier que le
      // serveur refusera — a fortiori hors-ligne, où le refus n'arriverait
      // qu'au rejeu, trop tard (ADR-018 D7).
      const candidateIds = [
        ...new Set(groupRows.flatMap((g) => (g.combo_group_options ?? []).map((o) => o.component_product_id))),
      ];
      const parentIds = new Set<string>();
      if (candidateIds.length > 0) {
        // Un composant est « parent » s'il porte au moins un enfant vivant —
        // même sonde que le EXISTS de _assert_product_sellable_v1.
        const probe = await supabase
          .from('products')
          .select('parent_product_id')
          .in('parent_product_id', candidateIds)
          .eq('is_active', true)
          .is('deleted_at', null);
        if (probe.error) throw probe.error;
        for (const r of probe.data ?? []) {
          if (r.parent_product_id !== null) parentIds.add(r.parent_product_id);
        }
      }
      const isSellableOption = (o: OptionRow): boolean => {
        const c = one(o.component);
        if (c === null) return false;
        if (!c.is_active || c.deleted_at !== null) return false;
        return !parentIds.has(o.component_product_id);
      };

      // Distinct components across all groups — one round-trip for all of them.
      // Seuls les composants retenus : inutile de résoudre les modificateurs
      // d'une option que l'on n'affichera pas.
      const componentRefs = new Map<string, { product_id: string; category_id: string | null }>();
      for (const g of groupRows) {
        for (const o of (g.combo_group_options ?? []).filter(isSellableOption)) {
          componentRefs.set(o.component_product_id, {
            product_id: o.component_product_id,
            category_id: one(o.component)?.category_id ?? null,
          });
        }
      }
      const modifiersByComponent = await fetchComponentModifierGroups([...componentRefs.values()]);

      const groups: ComboDefinition['groups'] = groupRows.map((g) => {
        const opts = [...(g.combo_group_options ?? [])]
          .filter(isSellableOption)
          .sort((a, b) => a.sort_order - b.sort_order);
        return {
          id: g.id,
          name: g.name,
          group_type: (g.group_type as 'single' | 'multi') ?? 'single',
          is_required: g.is_required,
          min_select: g.min_select,
          max_select: g.max_select,
          sort_order: g.sort_order,
          options: opts.map((o) => {
            const modGroups = modifiersByComponent[o.component_product_id];
            return {
              id: o.component_product_id,
              component_product_id: o.component_product_id,
              label: one(o.component)?.name ?? '—',
              surcharge: Number(o.surcharge),
              is_default: o.is_default,
              sort_order: o.sort_order,
              ...(modGroups ? { component_modifier_groups: modGroups } : {}),
            };
          }),
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
