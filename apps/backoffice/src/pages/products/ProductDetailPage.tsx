// apps/backoffice/src/pages/products/ProductDetailPage.tsx
//
// Session 14 / Phase 4.B — Product detail page (read-only baseline).
// Session 27 — Wave 2 — Wired the Save button to update_product_v1 RPC. The
// General tab now tracks a controlled draft + dirty flag; clicking Save fires
// the JSONB patch and the page refetches on success.
//
// URL: /backoffice/products/:productId

import { useEffect, useMemo, useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { GeneralPanel } from '@/features/products/components/GeneralPanel.js';
import { OverviewPanel } from '@/features/products/components/OverviewPanel.js';
import { ProductDetailHeader } from '@/features/products/components/ProductDetailHeader.js';
import { ProductDetailTabs } from '@/features/products/components/ProductDetailTabs.js';
import { CostingPanel } from '@/features/products/components/CostingPanel.js';
import { StubPanel } from '@/features/products/components/StubPanel.js';
import { UnitsPanel } from '@/features/products/components/UnitsPanel.js';
import { VariantsPanel } from '@/features/products/components/VariantsPanel.js';
import { useCategories } from '@/features/products/hooks/useCategories.js';
import { useProductDetail } from '@/features/products/hooks/useProductDetail.js';
import { useProductDisplayStock } from '@/features/products/hooks/useProductDisplayStock.js';
import { useUpdateProduct, type ProductUpdatePatch } from '@/features/products/hooks/useUpdateProduct.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { ProductDetailTab, ProductRow } from '@/features/products/types.js';
import { RecipeBuilder } from '@/features/recipes/index.js';

export default function ProductDetailPage(): JSX.Element {
  const { productId } = useParams<{ productId: string }>();
  const product = useProductDetail(productId ?? null);
  const displayStock = useProductDisplayStock(
    productId ?? null,
    product.data?.is_display_item === true,
  );
  const categories = useCategories();
  const updateProduct = useUpdateProduct();
  const canUpdate = useAuthStore((s) => s.hasPermission('products.update'));
  const [tab, setTab] = useState<ProductDetailTab>('overview');
  const [patch, setPatch] = useState<ProductUpdatePatch>({});

  useEffect(() => {
    setPatch({});
  }, [product.data?.id]);

  const isDirty = useMemo(() => Object.keys(patch).length > 0, [patch]);

  function handleFieldChange(p: Partial<ProductRow>): void {
    setPatch((prev) => ({ ...prev, ...(p as ProductUpdatePatch) }));
  }

  function handleSave(): void {
    if (productId === undefined || !isDirty) return;
    updateProduct.mutate(
      { productId, patch },
      {
        onSuccess: () => setPatch({}),
      },
    );
  }

  if (product.isLoading) {
    return <div className="py-16 text-center text-sm text-text-secondary">Loading product…</div>;
  }
  if (product.error !== null && product.error !== undefined) {
    return (
      <div className="rounded-lg border border-red bg-red-soft p-4 text-sm text-red" role="alert">
        Failed to load product: {(product.error as Error).message}
      </div>
    );
  }
  if (product.data === null || product.data === undefined) {
    return <div className="py-16 text-center text-sm text-text-secondary">Product not found.</div>;
  }

  const p = product.data;

  return (
    <div className="space-y-6">
      <ProductDetailHeader
        name={p.name}
        sku={p.sku}
        isDirty={isDirty && canUpdate}
        onSave={canUpdate ? handleSave : undefined}
        isSaving={updateProduct.isPending}
      />
      {updateProduct.error !== null && (
        <div
          role="alert"
          className="rounded-lg border border-red bg-red-soft p-3 text-sm text-red"
          data-testid="product-detail-save-error"
        >
          Failed to save: {updateProduct.error.message}
        </div>
      )}
      <ProductDetailTabs active={tab} onChange={setTab} />

      <div data-testid={`product-tab-${tab}`}>
        {tab === 'overview' && <OverviewPanel product={p} />}
        {tab === 'general'  && (
          <GeneralPanel
            product={p}
            categories={categories.data ?? []}
            readOnly={!canUpdate}
            onChange={handleFieldChange}
            displayStockQty={displayStock.data ?? null}
          />
        )}
        {tab === 'units'    && <UnitsPanel product={p} />}
        {tab === 'recipe'   && (
          <RecipeBuilder
            productId={p.id}
            productName={p.name}
            productUnit={p.unit}
            readOnly={false}
          />
        )}
        {tab === 'variants' && (
          <VariantsPanel
            product={{
              id:                p.id,
              name:              p.name,
              parent_product_id: p.parent_product_id,
              variant_label:     p.variant_label,
              variant_axis:      p.variant_axis,
            }}
          />
        )}
        {tab === 'costing' && (
          <CostingPanel product={p} />
        )}
        {tab === 'purchase' && (
          <StubPanel
            title="Purchase history coming soon"
            description="Suppliers, last-purchase price and lead-time will surface here as the purchasing module matures."
          />
        )}
        {tab === 'history' && (
          <StubPanel
            title="Audit trail coming soon"
            description="A unified change-log of price, recipe and stock edits will land here in a follow-up session."
          />
        )}
      </div>
    </div>
  );
}
