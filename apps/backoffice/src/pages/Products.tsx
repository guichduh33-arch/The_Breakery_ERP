// apps/backoffice/src/pages/Products.tsx
//
// Écran 2a — le catalogue.
//
// Même coquille que le dashboard 1c : plus de carte d'en-tête, plus de pilules,
// la largeur entière pour les données. Le changement de fond est la BANDE DE
// COMPTEURS : quatre tuiles qui affichaient sont devenues sept cellules qui
// filtrent, dont deux comptent un DÉFAUT (produit désactivé oublié, produit sans
// prix de revient). Un écran de gestion doit désigner du travail, pas se
// contenter de mesurer un stock de lignes.
//
// Écritures inchangées : S27 update, S27b create + catégories, S27c variantes,
// S45 soft-delete (delete_product_v1, gate products.delete). Les actions
// GROUPÉES du pied de table restent inertes — elles réclament des RPC de masse
// gatées et auditées qui n'existent pas.

import { useEffect, useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProductsHeader } from '@/features/products/components/ProductsHeader.js';
import { ProductsPageTabs } from '@/features/products/components/ProductsPageTabs.js';
import { ProductsCounterStrip } from '@/features/products/components/ProductsCounterStrip.js';
import { ProductsFilters } from '@/features/products/components/ProductsFilters.js';
import { ProductsTable } from '@/features/products/components/ProductsTable.js';
import { ProductsGrid } from '@/features/products/components/ProductsGrid.js';
import { NewProductDialog } from '@/features/products/components/NewProductDialog.js';
import { DeleteProductDialog } from '@/features/products/components/DeleteProductDialog.js';
import { useProducts } from '@/features/products/hooks/useProducts.js';
import { useCategories } from '@/features/products/hooks/useCategories.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { useAuthStore } from '@/stores/authStore.js';
import {
  classifyProduct,
  type ProductColumnId,
  type ProductCounter,
  type ProductView,
  type ProductsKpis,
  type ProductRow,
  type ProductVariantFilter,
} from '@/features/products/types.js';

const COUNTERS = new Set<ProductCounter>([
  'all', 'finished', 'semi-finished', 'raw', 'combo', 'inactive', 'no-cost',
]);

function matchesCounter(r: ProductRow, counter: ProductCounter): boolean {
  switch (counter) {
    case 'all':      return true;
    case 'inactive': return !r.is_active;
    case 'no-cost':  return r.cost_price <= 0;
    default:         return classifyProduct(r) === counter;
  }
}

export default function ProductsPage(): JSX.Element {
  const navigate = useNavigate();
  const products = useProducts();
  const categories = useCategories();
  const canCreate      = useAuthStore((s) => s.hasPermission('products.create'));
  const canDelete      = useAuthStore((s) => s.hasPermission('products.delete'));
  const canEditPricing = useAuthStore((s) => s.hasPermission('products.update'));
  const canImport      = useAuthStore((s) => s.hasPermission('catalog.import'));

  // Le compteur actif vit dans l'URL : un lien vers « les 6 produits sans prix
  // de revient » doit pouvoir se coller dans une conversation.
  const [counterParam, setCounterParam] = useUrlState('counter', 'all');
  const counter: ProductCounter = COUNTERS.has(counterParam as ProductCounter)
    ? (counterParam as ProductCounter)
    : 'all';

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [view, setView] = useState<ProductView>('list');
  const [variantFilter, setVariantFilter] = useState<ProductVariantFilter>('all');
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<ProductColumnId>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [toDelete, setToDelete] = useState<ProductRow | null>(null);

  // `?? []` crée un tableau NEUF à chaque rendu : mémoïsé, sans quoi les trois
  // useMemo qui en dépendent se recalculent à chaque frappe dans la recherche.
  const rows: ProductRow[] = useMemo(() => products.data ?? [], [products.data]);

  // Session 27c — l'ensemble des parents se dérive du catalogue déjà chargé,
  // le filtre « parents seuls » n'a pas besoin d'une seconde requête.
  const parentIds = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.parent_product_id !== null) set.add(r.parent_product_id);
    }
    return set;
  }, [rows]);

  const kpis: ProductsKpis = useMemo(() => {
    const k: ProductsKpis = {
      total: 0, finished: 0, semi_finished: 0, raw_material: 0, combo: 0,
      inactive: 0, no_cost_price: 0,
    };
    for (const r of rows) {
      k.total += 1;
      const t = classifyProduct(r);
      if (t === 'finished') k.finished += 1;
      else if (t === 'semi-finished') k.semi_finished += 1;
      else if (t === 'raw') k.raw_material += 1;
      else if (t === 'combo') k.combo += 1;
      if (!r.is_active) k.inactive += 1;
      if (r.cost_price <= 0) k.no_cost_price += 1;
    }
    return k;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchesCounter(r, counter)) return false;
      if (categoryId !== 'all' && r.category_id !== categoryId) return false;
      // Session 27c — filtre de regroupement des variantes
      if (variantFilter === 'variants' && r.parent_product_id === null) return false;
      if (variantFilter === 'standalone' && (r.parent_product_id !== null || parentIds.has(r.id))) return false;
      if (variantFilter === 'parents' && !parentIds.has(r.id)) return false;
      if (needle === '') return true;
      return r.name.toLowerCase().includes(needle) || r.sku.toLowerCase().includes(needle);
    });
  }, [rows, search, categoryId, variantFilter, counter, parentIds]);

  // Un changement de filtre remet en page 1 : rester en page 7 d'un résultat
  // qui n'en compte plus que 2 affiche une table vide qu'on croit cassée.
  useEffect(() => { setPage(1); }, [search, categoryId, variantFilter, counter]);

  function toggleColumn(id: ProductColumnId): void {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleRow(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: readonly string[], allSelected: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id); else next.add(id);
      }
      return next;
    });
  }

  function openProduct(row: ProductRow): void {
    void navigate(`/backoffice/products/${row.id}`);
  }

  function openPricing(row: ProductRow): void {
    void navigate(`/backoffice/products/${row.id}?tab=general`);
  }

  if (products.error !== null && products.error !== undefined) {
    return (
      <div className="rounded-md border border-danger bg-red-soft p-4 text-sm text-danger" role="alert">
        Failed to load products: {products.error.message}
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <ProductsHeader
        count={kpis.total}
        isLoading={products.isLoading}
        onNew={canCreate ? () => { setShowNew(true); } : undefined}
        {...(canImport ? { onImport: () => { void navigate('/backoffice/products/import-export'); } } : {})}
        onRecipes={() => { void navigate('/backoffice/inventory/recipes'); }}
      />
      <ProductsPageTabs />

      {showNew && (
        <NewProductDialog
          categories={categories.data ?? []}
          onClose={() => { setShowNew(false); }}
          onCreated={(newId) => { void navigate(`/backoffice/products/${newId}`); }}
        />
      )}

      <DeleteProductDialog product={toDelete} onClose={() => { setToDelete(null); }} />

      <ProductsCounterStrip
        kpis={kpis}
        active={counter}
        onSelect={(next) => { setCounterParam(next); }}
        isLoading={products.isLoading}
      />

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
        hiddenColumns={hiddenColumns}
        onToggleColumn={toggleColumn}
      />

      {view === 'list' ? (
        <ProductsTable
          rows={filtered}
          isLoading={products.isLoading}
          parentIds={parentIds}
          hiddenColumns={hiddenColumns}
          page={page}
          onPage={setPage}
          selected={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          onRowClick={openProduct}
          onView={openProduct}
          {...(canEditPricing ? { onPricing: openPricing } : {})}
          {...(canDelete ? { onDelete: (row: ProductRow) => { setToDelete(row); } } : {})}
        />
      ) : (
        <ProductsGrid rows={filtered} parentIds={parentIds} onCardClick={openProduct} />
      )}
    </div>
  );
}
