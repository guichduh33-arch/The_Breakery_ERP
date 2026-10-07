import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Product } from '@breakery/domain';
import { useSaleQueryEnabled } from '@/features/lan/hooks/useSaleQueryEnabled';
import { productModifiersOptions } from './useProductModifiers';

/** Deux travailleurs ; le nettoyage abandonne uniquement les tâches en attente. */
export function usePrefetchProductModifiers(products: Product[], ready: boolean): void {
  const candidates = useMemo(() => products.filter((p) => !p.has_variants && p.product_type !== 'combo').slice(0, 12)
    .map((product) => ({ productId: product.id, categoryId: product.category_id })), [products]);
  usePrefetchModifierOptions(candidates, ready);
}

export function usePrefetchModifierOptions(
  candidates: readonly { productId: string; categoryId: string | null }[],
  ready: boolean,
  gcTime?: number,
): void {
  const client = useQueryClient();
  const enabled = useSaleQueryEnabled(ready);
  const lanes = useRef([Promise.resolve(), Promise.resolve()]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let index = 0;
    async function worker() {
      while (!cancelled && index < candidates.length) {
        const product = candidates[index++];
        if (!product) return;
        await client.prefetchQuery({ ...productModifiersOptions(product), ...(gcTime === undefined ? {} : { gcTime }) });
      }
    }
    lanes.current = lanes.current.map((previous) => previous.then(worker));
    return () => { cancelled = true; };
  }, [client, candidates, enabled, gcTime]);
}
