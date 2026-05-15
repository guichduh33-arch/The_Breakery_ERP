// apps/pos/src/features/products/ProductTapHandler.tsx
//
// Glue between `<ProductGrid>` and `cartStore.add`. When the cashier taps a
// product:
//   1. Fetch the product's merged modifier groups.
//   2. Combo products: skip ModifierModal entirely (spec CB5). If combo has
//      modifier groups → toast error and abort. Otherwise → addItem direct.
//   3. Finished products: existing flow (open ModifierModal if groups, else direct).
//
// Customer pricing: if a customer is attached, unit_price is resolved via
// get_customer_product_price RPC before addItem. Spec §4.4.
import { useState } from 'react';
import { toast } from 'sonner';
import { ModifierModal, type ModifierModalProduct } from '@breakery/ui';
import type { Product, SelectedModifiers } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { useCustomerProductPrice } from '@/features/customerCategories/hooks/useCustomerProductPrice';
import { ProductGrid } from './ProductGrid';
import { useProductModifiers } from './hooks/useProductModifiers';

export interface ProductTapHandlerProps {
  selectedSlug: string | null;
}

export function ProductTapHandler({ selectedSlug }: ProductTapHandlerProps) {
  const add = useCartStore((s) => s.add);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const [pending, setPending] = useState<Product | null>(null);
  const fetchPrice = useCustomerProductPrice();

  const modifiersQuery = useProductModifiers({
    productId: pending?.id ?? '',
    categoryId: pending?.category_id ?? null,
    enabled: pending !== null,
  });

  async function addWithPrice(product: Product, modifiers: SelectedModifiers) {
    try {
      const price = await fetchPrice(product.id, attachedCustomer?.id ?? null);
      add(product, modifiers, price);
    } catch {
      add(product, modifiers);
    }
  }

  function handleSelect(product: Product) {
    setPending(product);
  }

  function handleConfirm(selections: SelectedModifiers) {
    if (pending) void addWithPrice(pending, selections);
    setPending(null);
  }

  function handleClose() {
    setPending(null);
  }

  if (pending && modifiersQuery.isSuccess) {
    const groups = modifiersQuery.data;
    if (pending.product_type === 'combo') {
      if (groups.length > 0) {
        toast.error('Modifiers not supported on combos');
      } else {
        void addWithPrice(pending, []);
      }
      queueMicrotask(() => setPending(null));
    } else if (groups.length === 0) {
      void addWithPrice(pending, []);
      queueMicrotask(() => setPending(null));
    }
  }

  const isCombo = pending?.product_type === 'combo';
  const groups = modifiersQuery.data ?? [];
  const modalOpen = Boolean(pending) && modifiersQuery.isSuccess && groups.length > 0 && !isCombo;

  const product: ModifierModalProduct | null =
    pending && !isCombo
      ? {
          id: pending.id,
          name: pending.name,
          retail_price: pending.retail_price,
          image_url: pending.image_url ?? null,
        }
      : null;

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
