// apps/pos/src/features/products/ProductTapHandler.tsx
//
// Glue between `<ProductGrid>` and `cartStore.add`. When the cashier taps a
// product:
//   1. Session 27c — if the product is a parent (`has_variants === true`),
//      open the VariantSelectModal. When the cashier picks a variant, we
//      synthesise a `Product` shape from (parent + variant) and feed it into
//      the existing modifier-then-add pipeline. Variants are always
//      `product_type='finished'` per the Wave 1 CHECK ; modifiers attach to
//      the parent's category, so we keep the parent's `category_id` in the
//      synthesised product so `useProductModifiers` resolves correctly.
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
import { VariantSelectModal } from '@/features/cart/VariantSelectModal';
import type { POSVariantRow } from '@/features/products/hooks/useProductVariants';
import { ProductGrid } from './ProductGrid';
import { useProductModifiers } from './hooks/useProductModifiers';

export interface ProductTapHandlerProps {
  selectedSlug: string | null;
}

export function ProductTapHandler({ selectedSlug }: ProductTapHandlerProps) {
  const add = useCartStore((s) => s.add);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const [pending, setPending] = useState<Product | null>(null);
  // Session 27c — variant picker state. The parent product is preserved so
  // we can synthesise the chosen variant into a Product-shaped object that
  // inherits the parent's category_id (for modifier resolution), image_url,
  // tax_inclusive, etc.
  const [variantParent, setVariantParent] = useState<Product | null>(null);
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
    // Session 27c — parent products open the variant picker first.
    if (product.has_variants) {
      setVariantParent(product);
      return;
    }
    setPending(product);
  }

  function handleVariantPick(variant: POSVariantRow) {
    if (!variantParent) return;
    // Synthesise a `Product` from the chosen variant + parent fallbacks.
    // Modifier resolution uses `category_id`, which variants inherit from
    // the parent. Variants are constrained to `product_type='finished'` per
    // the Wave 1 CHECK ; we hard-code it here rather than reading from the
    // variant row (which doesn't carry the column).
    const synth: Product = {
      id: variant.id,
      sku: variantParent.sku,
      name: variant.name,
      category_id: variantParent.category_id,
      retail_price: variant.retail_price,
      wholesale_price: variantParent.wholesale_price,
      product_type: 'finished',
      tax_inclusive: variantParent.tax_inclusive,
      image_url: variantParent.image_url,
      current_stock: variant.current_stock ?? 0,
      is_active: variant.is_active,
      is_favorite: false,
      parent_product_id: variantParent.id,
      has_variants: false,
    };
    setVariantParent(null);
    setPending(synth);
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
      <VariantSelectModal
        open={variantParent !== null}
        onOpenChange={(o) => {
          if (!o) setVariantParent(null);
        }}
        parent={variantParent ? { id: variantParent.id, name: variantParent.name } : null}
        onPick={handleVariantPick}
      />
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
