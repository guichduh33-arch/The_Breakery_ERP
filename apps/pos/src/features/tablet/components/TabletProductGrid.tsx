import type { JSX } from 'react';
import { useState } from 'react';
import { ModifierModal, type ModifierModalProduct } from '@breakery/ui';
import type { Product, SelectedModifiers } from '@breakery/domain';
import { ProductGrid } from '@/features/products/ProductGrid';
import { useProductModifiers } from '@/features/products/hooks/useProductModifiers';
import { useTabletCartStore } from '@/stores/tabletCartStore';

export interface TabletProductGridProps {
  selectedSlug: string | null;
}

export function TabletProductGrid({ selectedSlug }: TabletProductGridProps): JSX.Element {
  const addItem = useTabletCartStore((s) => s.addItem);
  const [pending, setPending] = useState<Product | null>(null);

  const modifiersQuery = useProductModifiers({
    productId: pending?.id ?? '',
    categoryId: pending?.category_id ?? null,
    enabled: pending !== null,
  });

  function handleSelect(product: Product) {
    setPending(product);
  }

  function handleConfirm(selections: SelectedModifiers) {
    if (pending) addItem(pending, selections);
    setPending(null);
  }

  function handleClose() {
    setPending(null);
  }

  if (pending && modifiersQuery.isSuccess) {
    const groups = modifiersQuery.data;
    if (groups.length === 0) {
      addItem(pending, []);
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
