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
//   2. Session 47 — Combo products open `ComboConfigModal` directly (bypasses
//      the modifier pipeline entirely). On confirm, `addCombo` is called with
//      the chosen components + modifiers snapshot. Combos never route through
//      `setPending` or `useProductModifiers`.
//   3. Finished products: existing flow (open ModifierModal if groups, else direct).
//
// Customer pricing: if a customer is attached, unit_price is resolved via
// get_customer_product_price RPC before addItem. Combos use
// `combo_base_price` (emitted by ComboConfigModal as `unitPrice`) and do NOT
// go through the fetchPrice path.
import { useEffect, useRef, useState } from 'react';
import { ModifierModal, type ModifierModalProduct } from '@breakery/ui';
import type { Product, SelectedModifiers } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { useCustomerProductPrice } from '@/features/customerCategories/hooks/useCustomerProductPrice';
import { VariantSelectModal } from '@/features/cart/VariantSelectModal';
import type { POSVariantRow } from '@/features/products/hooks/useProductVariants';
import { ComboConfigModal } from '@/features/combos/components/ComboConfigModal';
import { ProductGrid } from './ProductGrid';
import { useProductModifiers } from './hooks/useProductModifiers';

export interface ProductTapHandlerProps {
  selectedSlug: string | null;
}

export function ProductTapHandler({ selectedSlug }: ProductTapHandlerProps) {
  const add = useCartStore((s) => s.add);
  const addCombo = useCartStore((s) => s.addCombo);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const [pending, setPending] = useState<Product | null>(null);
  // Session 27c — variant picker state. The parent product is preserved so
  // we can synthesise the chosen variant into a Product-shaped object that
  // inherits the parent's category_id (for modifier resolution), image_url,
  // tax_inclusive, etc.
  const [variantParent, setVariantParent] = useState<Product | null>(null);
  // Session 47 — combo picker state. Combos bypass the modifier pipeline.
  const [comboPending, setComboPending] = useState<Product | null>(null);
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
    // Session 47 — combos open ComboConfigModal directly; never enter the
    // modifier pipeline.
    if (product.product_type === 'combo') {
      setComboPending(product);
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

  // Bug 2 (Session 36) — auto-add for products that need no modifier choice
  // (finished products with no groups). This MUST live in an effect, not in
  // the render body: running `add()` during render made StrictMode's dev
  // double-render fire it TWICE for a single tap, doubling the line quantity.
  // The ref guards against a re-fire for the same `pending` product before
  // `setPending(null)` commits.
  //
  // Session 47: combos never set `pending` — they go through `comboPending` +
  // `ComboConfigModal` instead. The combo branch is therefore removed here.
  const autoAddedRef = useRef<Product | null>(null);
  useEffect(() => {
    if (!pending || !modifiersQuery.isSuccess) {
      autoAddedRef.current = null;
      return;
    }
    if (autoAddedRef.current === pending) return;
    const groups = modifiersQuery.data ?? [];
    if (groups.length === 0) {
      autoAddedRef.current = pending;
      void addWithPrice(pending, []);
      setPending(null);
    }
    // groups.length > 0 → the ModifierModal opens; nothing to add here.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addWithPrice is a
    // stable closure recreated each render; depending on it would re-run the
    // effect on every render. The (pending, query-success, data) tuple fully
    // captures when an auto-add should fire.
  }, [pending, modifiersQuery.isSuccess, modifiersQuery.data]);

  const groups = modifiersQuery.data ?? [];
  const modalOpen = Boolean(pending) && modifiersQuery.isSuccess && groups.length > 0;

  const product: ModifierModalProduct | null = pending
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
      {/* Session 47 — combo configuration modal */}
      <ComboConfigModal
        open={comboPending !== null}
        product={comboPending ? { id: comboPending.id, name: comboPending.name } : null}
        onConfirm={({ components, modifiers, unitPrice }) => {
          if (comboPending) addCombo(comboPending, modifiers, components, unitPrice);
          setComboPending(null);
        }}
        onClose={() => setComboPending(null)}
      />
    </>
  );
}
