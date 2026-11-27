// apps/pos/src/features/products/hooks/useProductModifiers.ts
//
// Fetch the modifier rows attached either to a product OR to its category
// (XOR scope, spec §3.1). `mergeGroups()` folds them into a sorted, grouped
// structure with product-level overrides winning.
//
// Une seule lecture pour tout le catalogue (relevé prod du 2026-11-27) : la
// caisse monte une query par produit pour la vente hors ligne (~360). Chaque
// push catalogue les invalidait toutes et produisait autant de requêtes —
// 176 000 en une journée de 100 commandes, qui retardaient l'affichage des
// commandes tablette. Les queries par produit gardent leur clé (manifeste
// hors ligne inchangé) mais lisent la liste partagée : une invalidation du
// préfixe `product-modifiers` marque aussi la liste, et les relectures
// simultanées se rejoignent sur un seul appel réseau.
//
// NOTE: the generated Supabase type set in `@breakery/supabase` does not
// include the `product_modifiers` table; we describe the row shape locally
// and treat the supabase client as untyped for this single call.
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  mergeGroups,
  type ModifierGroup,
  type ProductModifierRow,
} from '@breakery/domain';
import { supabase } from '@/lib/supabase';
import { useSaleQueryEnabled } from '@/features/lan/hooks/useSaleQueryEnabled';

export interface UseProductModifiersArgs {
  productId: string;
  categoryId: string | null;
  /** Disable the query when the product has no modifiers expected. */
  enabled?: boolean;
}

const MODIFIER_COLUMNS =
  'id, product_id, category_id, group_name, group_sort_order, group_required, group_type, option_label, option_icon, option_sort_order, price_adjustment, is_default, is_active';

/** Taille de page PostgREST : la liste complète se lit par tranches ordonnées. */
const PAGE_SIZE = 1000;

/**
 * Clé de la liste partagée. Deux éléments : hors du manifeste hors ligne
 * (`isSaleSnapshotQuery` n'y retient que les clés à trois éléments), mais sous
 * le préfixe que le push catalogue invalide.
 */
export const ALL_PRODUCT_MODIFIERS_KEY = ['product-modifiers', '__all__'] as const;

/**
 * Minimal builder shape we rely on. Until `product_modifiers` is part of the
 * generated Database types, we coerce the client through `unknown` to a tiny
 * structural interface that exposes only the chain calls we need.
 */
interface ModifierQueryBuilder {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        is(column: string, value: unknown): {
          order(column: string): {
            range(from: number, to: number): Promise<{
              data: ProductModifierRow[] | null;
              error: Error | null;
            }>;
          };
        };
      };
    };
  };
}

async function fetchAllModifierRows(): Promise<ProductModifierRow[]> {
  // Cast through unknown — see file header NOTE.
  const client = supabase as unknown as ModifierQueryBuilder;
  const rows: ProductModifierRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('product_modifiers')
      .select(MODIFIER_COLUMNS)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Liste partagée ; un appel en cours est rejoint, pas relancé. */
export function fetchAllProductModifiers(client: QueryClient): Promise<ProductModifierRow[]> {
  return client.fetchQuery({ queryKey: ALL_PRODUCT_MODIFIERS_KEY, queryFn: fetchAllModifierRows });
}

/** Lignes qui concernent ce produit : les siennes, puis celles de sa catégorie. */
export function modifierRowsFor(
  rows: readonly ProductModifierRow[],
  productId: string,
  categoryId: string | null,
): ProductModifierRow[] {
  return rows.filter((row) => row.product_id === productId
    || (categoryId !== null && row.category_id === categoryId));
}

export function productModifiersOptions({
  productId,
  categoryId,
}: UseProductModifiersArgs) {
  return queryOptions({
    queryKey: ['product-modifiers', productId, categoryId],
    queryFn: async ({ client }): Promise<ModifierGroup[]> => {
      const rows = await fetchAllProductModifiers(client);
      return mergeGroups(modifierRowsFor(rows, productId, categoryId));
    },
  });
}

export function useProductModifiers(args: UseProductModifiersArgs) {
  const enabled = useSaleQueryEnabled(args.enabled ?? true);
  return useQuery({ ...productModifiersOptions(args), enabled });
}
