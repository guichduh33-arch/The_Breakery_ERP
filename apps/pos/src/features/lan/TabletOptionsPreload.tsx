import { useMemo } from 'react';
import { useProducts } from '@/features/products/hooks/useProducts';
import { usePromotionVariants } from '@/features/products/hooks/usePromotionVariants';
import { usePrefetchModifierOptions } from '@/features/products/hooks/usePrefetchProductModifiers';

/** Prépare les options avant une coupure WAN, sans ouvrir de shift de caisse. */
export function TabletOptionsPreload() {
  const { data: products } = useProducts();
  const variants = usePromotionVariants((products ?? []).filter((product) => product.has_variants).map((product) => product.id));
  const candidates = useMemo(() => (products ?? []).flatMap((product) => [
    { productId: product.id, categoryId: product.category_id },
    ...(variants.get(product.id) ?? []).map((variant) => ({ productId: variant.id, categoryId: product.category_id })),
  ]), [products, variants]);
  // Garder ces options en mémoire durant la session, même après une longue coupure.
  usePrefetchModifierOptions(candidates, products !== undefined, Infinity);
  return null;
}
