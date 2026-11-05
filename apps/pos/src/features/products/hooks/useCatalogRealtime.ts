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
// Le topic catalogue signale les changements de produits sans exposer de
// payload de stock. Les catégories restent publiées directement.
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

// A categories event touches the category nav AND the product grid: rows
// embed categories(dispatch_station), and grid grouping follows sort_order.
const CATEGORIES_KEYS: readonly (readonly string[])[] = [
  ['categories'],
  ['products'],
  ['combo-config'],
  ['product-modifiers'],
];

const ALL_CATALOG_KEYS: readonly (readonly string[])[] = [
  ['products'],
  ['pos-product-variants'],
  ['pos-product-variants-batch'],
  ['categories'],
  ['display', 'showcase-products'],
  ['combo-config'],
  ['product-modifiers'],
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
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: 'categories' } as never,
        () => invalidateAll(qc, CATEGORIES_KEYS),
      )
      .on(
        'postgres_changes' as never,
        { event: 'UPDATE', schema: 'public', table: 'ui_invalidation_topics', filter: 'topic=eq.catalog' } as never,
        () => invalidateAll(qc, ALL_CATALOG_KEYS),
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
