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
import { useProducts } from '@/features/products/hooks/useProducts.js';
import { useCategories } from '@/features/products/hooks/useCategories.js';
import { useResolvedAllergensMap } from '@/features/products/hooks/useResolvedAllergensMap.js';
import {
  classifyProduct,
  type ProductView,
  type ProductsKpis,
  type ProductRow,
} from '@/features/products/types.js';

export default function ProductsPage(): JSX.Element {
  const navigate = useNavigate();
  const products = useProducts();
  const categories = useCategories();
  const resolvedAllergens = useResolvedAllergensMap();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | 'all'>('all');
  const [view, setView] = useState<ProductView>('list');

  const rows: ProductRow[] = products.data ?? [];

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
      if (needle === '') return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.sku.toLowerCase().includes(needle)
      );
    });
  }, [rows, search, categoryId]);

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
      <ProductsHeader />

      <ProductsKpiGrid kpis={kpis} isLoading={products.isLoading} />

      <ProductsFilters
        search={search}
        onSearch={setSearch}
        categoryId={categoryId}
        onCategory={setCategoryId}
        categories={categories.data ?? []}
        view={view}
        onViewChange={setView}
      />

      {view === 'list' ? (
        <ProductsTable
          rows={filtered}
          isLoading={products.isLoading}
          resolvedAllergens={resolvedAllergens.data ?? new Map()}
          onRowClick={openProduct}
          onView={openProduct}
        />
      ) : (
        <ProductsGrid rows={filtered} onCardClick={openProduct} />
      )}
    </div>
  );
}
