// apps/backoffice/src/pages/products/ProductDetailPage.tsx
//
// Session 14 / Phase 4.B — Product detail page.
//
// URL: /backoffice/products/:productId
// Composition mirrors `Product detail1.jpg` & `Product detail2.jpg`:
//   - ProductDetailHeader with back arrow, name, SKU pill, Save changes CTA
//   - ProductDetailTabs (Overview · General · Units · Recipe · Variants ·
//     Costing · Purchase · History)
//   - Per-tab body — see ./components/{Overview,General,Units,Recipe}Panel.
//
// Save changes is intentionally inert: the product CRUD RPC family lands in
// a future session and we don't want to silently drop edits via direct
// inserts (the codebase rule forbids raw inserts; all writes go via RPCs).

import { useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import { GeneralPanel } from '@/features/products/components/GeneralPanel.js';
import { OverviewPanel } from '@/features/products/components/OverviewPanel.js';
import { ProductDetailHeader } from '@/features/products/components/ProductDetailHeader.js';
import { ProductDetailTabs } from '@/features/products/components/ProductDetailTabs.js';
import { StubPanel } from '@/features/products/components/StubPanel.js';
import { UnitsPanel } from '@/features/products/components/UnitsPanel.js';
import { useCategories } from '@/features/products/hooks/useCategories.js';
import { useProductDetail } from '@/features/products/hooks/useProductDetail.js';
import type { ProductDetailTab } from '@/features/products/types.js';
import { RecipeBuilder } from '@/features/recipes/index.js';

export default function ProductDetailPage(): JSX.Element {
  const { productId } = useParams<{ productId: string }>();
  const product = useProductDetail(productId ?? null);
  const categories = useCategories();
  const [tab, setTab] = useState<ProductDetailTab>('overview');

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
      <ProductDetailHeader name={p.name} sku={p.sku} isDirty={false} />
      <ProductDetailTabs active={tab} onChange={setTab} />

      <div data-testid={`product-tab-${tab}`}>
        {tab === 'overview' && <OverviewPanel product={p} />}
        {tab === 'general'  && <GeneralPanel product={p} categories={categories.data ?? []} readOnly />}
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
          <StubPanel
            title="Variants land in a future session"
            description="Configure size / colour / strength variants and per-variant pricing once the product CRUD RPCs ship."
          />
        )}
        {tab === 'costing' && (
          <StubPanel
            title="Costing arrives later"
            description="Detailed cost breakdown by ingredient and labour will appear here when the costing RPC ships."
          />
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
