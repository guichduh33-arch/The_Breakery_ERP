// apps/pos/src/features/products/hooks/useProducts.ts
//
// Session 27c — Wave 7.C — variant grouping :
//   1. Filter `parent_product_id IS NULL` so the main grid only shows parents
//      and standalones (children are picked via VariantSelectModal).
//   2. Derive `has_variants` per row from a second tiny query that lists the
//      distinct `parent_product_id` values across all active variants. This
//      avoids the PostgREST relation-embed complexity (forward self-FK on
//      `products` requires an explicit alias and is easier to get wrong than a
//      plain 2-step fetch).
// Session 34 — append `categories(dispatch_station)` to the select and flatten
//   the embedded relation onto each Product row (defaults to 'none').
import { useQuery } from '@tanstack/react-query';
import type { Product, DispatchStation } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => {
      // Step 1 : fetch parent + standalone products (parent_product_id IS NULL).
      const productsRes = await supabase
        .from('products')
        .select(
          'id, sku, name, category_id, retail_price, wholesale_price, product_type, tax_inclusive, image_url, current_stock, is_active, is_favorite, parent_product_id, categories(dispatch_station)',
        )
        .is('parent_product_id', null)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');

      if (productsRes.error) throw productsRes.error;

      // Step 2 : fetch the distinct parent_product_ids referenced by active
      // variants — used to flip `has_variants` on the matching parent rows.
      const variantsRes = await supabase
        .from('products')
        .select('parent_product_id')
        .not('parent_product_id', 'is', null)
        .eq('is_active', true)
        .is('deleted_at', null);

      if (variantsRes.error) throw variantsRes.error;

      const parentIds = new Set<string>(
        (variantsRes.data ?? [])
          .map((r) => r.parent_product_id)
          .filter((id): id is string => id !== null),
      );

      return (productsRes.data ?? []).map((p) => {
        // Flatten the embedded `categories` relation — PostgREST may return
        // either an object or an array depending on FK cardinality (same
        // normalisation pattern as useKdsOrders.ts `pickFirst`).
        const raw = p as unknown as typeof p & {
          categories: { dispatch_station: string } | { dispatch_station: string }[] | null;
        };
        const cat = Array.isArray(raw.categories)
          ? (raw.categories[0] ?? null)
          : raw.categories;
        const dispatch_station: DispatchStation =
          (cat?.dispatch_station as DispatchStation | undefined) ?? 'none';

        return {
          ...(p as unknown as Product),
          has_variants: parentIds.has(p.id),
          dispatch_station,
        };
      });
    },
  });
}
