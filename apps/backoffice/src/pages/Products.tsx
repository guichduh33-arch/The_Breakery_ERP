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

import { useCallback, useMemo, useState, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ProductsHeader } from '@/features/products/components/ProductsHeader.js';
import { ProductsPageTabs } from '@/features/products/components/ProductsPageTabs.js';
import { ProductsCounterStrip } from '@/features/products/components/ProductsCounterStrip.js';
import { ProductsFilters } from '@/features/products/components/ProductsFilters.js';
import { ProductsTable } from '@/features/products/components/ProductsTable.js';
import { ProductsGrid } from '@/features/products/components/ProductsGrid.js';
import { NewProductDialog } from '@/features/products/components/NewProductDialog.js';
import { DeleteProductDialog } from '@/features/products/components/DeleteProductDialog.js';
import {
  PRODUCTS_PAGE_SIZE_DEFAULT,
  coercePageSize,
} from '@/features/products/components/ProductsPagination.js';
import { useProducts } from '@/features/products/hooks/useProducts.js';
import { useCategories } from '@/features/products/hooks/useCategories.js';
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

  // TOUT l'état de liste vit dans l'URL, pas seulement le compteur.
  //
  // Deux raisons. La première existait déjà : un lien vers « les 6 produits sans
  // prix de revient » doit pouvoir se coller dans une conversation. La seconde
  // est le défaut qu'on corrige — ouvrir une fiche depuis la page 7 d'une
  // recherche puis revenir en arrière rendait la page 1 sans filtre. La
  // navigation vers une fiche empile une entrée d'historique ; si l'état de
  // liste n'est pas dans l'URL, le retour ne peut rien restaurer.
  //
  // Les écritures passent par `patchParams` et non par plusieurs `useUrlState` :
  // `setSearchParams` reçoit les paramètres COURANTS, donc deux appels dans le
  // même geste s'écrasent l'un l'autre — et changer un filtre doit écrire le
  // filtre ET remettre la page à 1 d'un seul mouvement.
  const [params, setParams] = useSearchParams();
  const patchParams = useCallback((patch: Record<string, string | null>): void => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') p.delete(k);
        else p.set(k, v);
      }
      return p;
    }, { replace: true });
  }, [setParams]);

  const counterParamRaw = params.get('counter') ?? 'all';
  const counter: ProductCounter = COUNTERS.has(counterParamRaw as ProductCounter)
    ? (counterParamRaw as ProductCounter)
    : 'all';
  const search        = params.get('q') ?? '';
  const categoryId    = params.get('cat') ?? 'all';
  const view: ProductView = params.get('view') === 'grid' ? 'grid' : 'list';
  const variantFilter = (params.get('variant') ?? 'all') as ProductVariantFilter;
  const page          = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const pageSize      = coercePageSize(params.get('rows'));

  // Un changement de filtre remet en page 1 : rester en page 7 d'un résultat qui
  // n'en compte plus que 2 afficherait une table vide qu'on croirait cassée.
  // C'est un geste, pas un effet — le faire dans un `useEffect` le rejouerait au
  // montage et écraserait la page que l'URL vient de restaurer.
  const setCounterParam = (next: string): void => { patchParams({ counter: next === 'all' ? null : next, page: null }); };
  const setSearch       = (next: string): void => { patchParams({ q: next, page: null }); };
  const setCategoryId   = (next: string): void => { patchParams({ cat: next === 'all' ? null : next, page: null }); };
  const setVariantFilter = (next: ProductVariantFilter): void => { patchParams({ variant: next === 'all' ? null : next, page: null }); };
  const setView         = (next: ProductView): void => { patchParams({ view: next === 'list' ? null : next }); };
  const setPage         = (next: number): void => { patchParams({ page: next <= 1 ? null : String(next) }); };
  // Changer la taille de page invalide le numéro de page : la ligne du haut de
  // la page 7 à 15 lignes n'est pas celle de la page 7 à 100.
  const setPageSize     = (next: number): void => {
    patchParams({ rows: next === PRODUCTS_PAGE_SIZE_DEFAULT ? null : String(next), page: null });
  };

  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<ProductColumnId>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
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
          pageSize={pageSize}
          onPageSize={setPageSize}
          selected={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          onRowClick={openProduct}
          onView={openProduct}
          {...(canEditPricing ? { onPricing: openPricing } : {})}
          {...(canDelete ? { onDelete: (row: ProductRow) => { setToDelete(row); } } : {})}
        />
      ) : (
        <ProductsGrid
          rows={filtered}
          parentIds={parentIds}
          onCardClick={openProduct}
          page={page}
          onPage={setPage}
          pageSize={pageSize}
          onPageSize={setPageSize}
        />
      )}
    </div>
  );
}
