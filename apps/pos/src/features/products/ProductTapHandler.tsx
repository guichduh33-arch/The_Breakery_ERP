// apps/pos/src/features/products/ProductTapHandler.tsx
//
// Glue between `<ProductGrid>` and `cartStore.add`. When the cashier taps a
// product:
//   1. Fetch the product's merged modifier groups (product-level + category
//      fallback, via `useProductModifiers`).
//   2. If there are no groups → add directly to the cart.
//   3. Otherwise → open the `ModifierModal`. On confirm, add the product to
//      the cart with the chosen selections.
//
// Spec ref §4.3.
import { useState } from 'react';
import { ModifierModal, type ModifierModalProduct } from '@breakery/ui';
import type { Product, SelectedModifiers } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { ProductGrid } from './ProductGrid';
import { useProductModifiers } from './hooks/useProductModifiers';

export interface ProductTapHandlerProps {
  selectedSlug: string | null;
}

export function ProductTapHandler({ selectedSlug }: ProductTapHandlerProps) {
  const add = useCartStore((s) => s.add);
  const [pending, setPending] = useState<Product | null>(null);

  // Always call hooks unconditionally — `enabled` toggles fetch.
  const modifiersQuery = useProductModifiers({
    productId: pending?.id ?? '',
    categoryId: pending?.category_id ?? null,
    enabled: pending !== null,
  });

  function handleSelect(product: Product) {
    setPending(product);
  }

  function handleConfirm(selections: SelectedModifiers) {
    if (pending) add(pending, selections);
    setPending(null);
  }

  function handleClose() {
    setPending(null);
  }

  // While the query is loading we keep `pending` set but DON'T render the
  // modal yet — instead we show a transient toast-less "pending" state by
  // simply waiting. When data lands:
  //   - empty groups → auto-add and close
  //   - has groups → open modal
  // We resolve this in render via early-return below.
  if (pending && modifiersQuery.isSuccess) {
    const groups = modifiersQuery.data;
    if (groups.length === 0) {
      // No modifiers → add directly, no modal
      add(pending, []);
      // Defer state update to next tick to avoid setting state during render.
      queueMicrotask(() => setPending(null));
    }
  }

  const product: ModifierModalProduct | null = pending
    ? { id: pending.id, name: pending.name, retail_price: pending.retail_price }
    : null;

  const groups = modifiersQuery.data ?? [];
  const modalOpen = Boolean(product) && modifiersQuery.isSuccess && groups.length > 0;

  return (
    <>
      <ProductGrid selectedSlug={selectedSlug} onSelect={handleSelect} />
      {product && (
        <ModifierModal
          open={modalOpen}
          product={product}
          groups={groups}
          onClose={handleClose}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}
