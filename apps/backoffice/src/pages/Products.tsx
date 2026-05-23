// apps/backoffice/src/pages/Products.tsx
//
// Session 14 / Phase 4.B — Catalog list view.
// Composition mirrors `product page.jpg` (header card -> KPI tiles ->
// search/filter strip -> dense table or card grid). Read-only — write paths
// arrive when the product CRUD RPCs land in a future session.

import { useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProductsHeader } from '@/features/products/components/ProductsHeader.js';
import { ProductsKpiGrid } from '@/features/products/components/ProductsKpiGrid.js';
import { ProductsFilters } from '@/features/products/components/ProductsFilters.js';
import { ProductsTable } from '@/features/products/components/ProductsTable.js';
import { ProductsGrid } from '@/features/products/components/ProductsGrid.js';
import { NewProductDialog } from '@/features/products/components/NewProductDialog.js';
import { useProducts } from '@/features/products/hooks/useProducts.js';
import { useCategories } from '@/features/products/hooks/useCategories.js';
import { useResolvedAllergensMap } from '@/features/products/hooks/useResolvedAllergensMap.js';
import { useAuthStore } from '@/stores/authStore.js';
import {
  classifyProduct,
  type ProductView,
  type ProductsKpis,
  type ProductRow,
  type ProductVariantFilter,
} from '@/features/products/types.js';

export default function ProductsPage(): JSX.Element {
  const navigate = useNavigate();
  const products = useProducts();
  const categories = useCategories();
  const resolvedAllergens = useResolvedAllergensMap();
  const canCreate = useAuthStore((s) => s.hasPermission('products.create'));

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | 'all'>('all');
  const [view, setView] = useState<ProductView>('list');
  const [variantFilter, setVariantFilter] = useState<ProductVariantFilter>('all');
  const [showNew, setShowNew] = useState(false);

  const rows: ProductRow[] = products.data ?? [];

  // Session 27c — derive the set of parent ids from the catalog so the
  // "parents only" filter can light up without a second query.
  const parentIds = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.parent_product_id !== null) set.add(r.parent_product_id);
    }
    return set;
  }, [rows]);

  const kpis: ProductsKpis = useMemo(() => {
    const k: ProductsKpis = { total: 0, finished: 0, semi_finished: 0, raw_material: 0, combo: 0 };
    for (const r of rows) {
      k.total += 1;
      const t = classifyProduct(r);
      if (t === 'finished') k.finished += 1;
      else if (t === 'semi-finished') k.semi_finished += 1;
      else if (t === 'raw') k.raw_material += 1;
      else if (t === 'combo') k.combo += 1;
    }
    return k;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (categoryId !== 'all' && r.category_id !== categoryId) return false;
      // Session 27c — variant grouping filter
      if (variantFilter === 'variants' && r.parent_product_id === null) return false;
      if (variantFilter === 'standalone' && (r.parent_product_id !== null || parentIds.has(r.id))) return false;
      if (variantFilter === 'parents' && !parentIds.has(r.id)) return false;
      if (needle === '') return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.sku.toLowerCase().includes(needle)
      );
    });
  }, [rows, search, categoryId, variantFilter, parentIds]);

  function openProduct(row: ProductRow): void {
    navigate(`/backoffice/products/${row.id}`);
  }

  if (products.error !== null && products.error !== undefined) {
    return (
      <div className="rounded-lg border border-red bg-red-soft p-4 text-sm text-red" role="alert">
        Failed to load products: {(products.error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProductsHeader onNew={canCreate ? () => setShowNew(true) : undefined} />

      {showNew && (
        <NewProductDialog
          categories={categories.data ?? []}
          onClose={() => setShowNew(false)}
          onCreated={(newId) => navigate(`/backoffice/products/${newId}`)}
        />
      )}

      <ProductsKpiGrid kpis={kpis} isLoading={products.isLoading} />

      <ProductsFilters
        search={search}
        onSearch={setSearch}
        categoryId={categoryId}
        onCategory={setCategoryId}
        categories={categories.data ?? []}
        view={view}
        onViewChange={setView}
        variantFilter={variantFilter}
        onVariantFilter={setVariantFilter}
      />

      {view === 'list' ? (
        <ProductsTable
          rows={filtered}
          isLoading={products.isLoading}
          resolvedAllergens={resolvedAllergens.data ?? new Map()}
          parentIds={parentIds}
          onRowClick={openProduct}
          onView={openProduct}
        />
      ) : (
        <ProductsGrid rows={filtered} parentIds={parentIds} onCardClick={openProduct} />
      )}
    </div>
  );
}
