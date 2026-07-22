// apps/pos/src/features/products/hooks/useCatalogRealtime.ts
//
// ADR-011 décision 3 — propagation Realtime du catalogue produits. Un
// changement fait en BO (désactivation, prix, visibilité POS, variantes,
// catégories) se propage en push < 2 s au comptoir et à la tablette au lieu
// d'attendre le prochain remount des hooks catalogue. La garde serveur v19
// (refus produits inactifs/parents dans complete_order_with_payment) reste le
// filet dur : ce hook réduit la fenêtre de vente d'un produit périmé, il ne
// la ferme pas.
//
// Subscribes postgres_changes on `products` and `categories` (published by
// migration 20260722000202) and invalidates the matching TanStack queries —
// the server stays the single source of truth (we trigger a re-read, we never
// trust the event payload). Mirror of useSettingsRealtime (ADR-006 déc. 4).
//
// On every SUBSCRIBED transition (initial join AND rejoin after a drop) all
// catalog keys are invalidated, so events missed while disconnected are
// caught up on reconnect.
//
// D19 — channel-name uniqueness per effect mount (UUID generated INSIDE the
// effect, never in a component-body useMemo): under StrictMode the second
// mount's `.on()` would otherwise attach to the still-subscribed channel of
// the first mount (`removeChannel` is async). See useKdsRealtime.ts.
//
// `enabled` gates the subscription on auth readiness: postgres_changes joins
// carry the CURRENT realtime token (realtime.setAuth, cf. packages/supabase
// client P0-2) and the RLS SELECT policies (`auth_read`) filter events — an
// anon join receives nothing. Callers re-arm by flipping `enabled`.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

// A products event touches the grid (useProducts, incl. the has_variants
// probe) and the variant picker (useProductVariants — prefix invalidation
// covers every ['pos-product-variants', parentId] entry).
const PRODUCTS_KEYS: readonly (readonly string[])[] = [
  ['products'],
  ['pos-product-variants'],
];

// A categories event touches the category nav AND the product grid: rows
// embed categories(dispatch_station), and grid grouping follows sort_order.
const CATEGORIES_KEYS: readonly (readonly string[])[] = [
  ['categories'],
  ['products'],
];

const ALL_CATALOG_KEYS: readonly (readonly string[])[] = [
  ['products'],
  ['pos-product-variants'],
  ['categories'],
];

function invalidateAll(
  qc: ReturnType<typeof useQueryClient>,
  keys: readonly (readonly string[])[],
): void {
  for (const key of keys) {
    void qc.invalidateQueries({ queryKey: [...key] });
  }
}

/**
 * Push propagation of BO catalog changes to this device. Mount once at the
 * App shell (PIN sessions — counter, tablet, KDS alike). Renders nothing,
 * returns nothing — consumers keep reading through their existing hooks.
 */
export function useCatalogRealtime(enabled: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return undefined;

    const channelName = `catalog-realtime-${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        // Same strict-literal typing workaround as useKdsRealtime.
        'postgres_changes' as never,
        // '*' : INSERT (création/variante), UPDATE (prix, is_active,
        // visible_on_pos…) et DELETE (dissolution parent hard-delete).
        { event: '*', schema: 'public', table: 'products' } as never,
        () => invalidateAll(qc, PRODUCTS_KEYS),
      )
      .on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: 'categories' } as never,
        () => invalidateAll(qc, CATEGORIES_KEYS),
      )
      .subscribe((status: string) => {
        // Initial join and every rejoin after CHANNEL_ERROR/TIMED_OUT: refresh
        // everything so changes missed while offline are picked up.
        if (status === 'SUBSCRIBED') invalidateAll(qc, ALL_CATALOG_KEYS);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}
