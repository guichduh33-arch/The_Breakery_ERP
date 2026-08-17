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
// S45 soft-delete (delete_product_v1, gate products.delete). La sélection
// multiple et les actions GROUPÉES du pied de table sont retirées (audit UX/UI
// 2026-08-13) : elles réclament des RPC de masse gatées et auditées qui
// n'existent pas, et une case à cocher sans action est une promesse fausse.

import { useEffect, useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProductsHeader } from '@/features/products/components/ProductsHeader.js';
import { ProductsPageTabs } from '@/features/products/components/ProductsPageTabs.js';
import { ProductsFilters } from '@/features/products/components/ProductsFilters.js';
import { ProductsTable } from '@/features/products/components/ProductsTable.js';
import { ProductsGrid } from '@/features/products/components/ProductsGrid.js';
import { NewProductDialog } from '@/features/products/components/NewProductDialog.js';
import { DeleteProductDialog } from '@/features/products/components/DeleteProductDialog.js';
import {
  LIST_PAGE_SIZE_DEFAULT,
  coercePageSize,
} from '@/components/ListPagination.js';
import { ListCounterStrip } from '@/components/ListCounterStrip.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { buildProductCounters } from '@/features/products/counters.js';
import { useProducts } from '@/features/products/hooks/useProducts.js';
import { useCategories } from '@/features/products/hooks/useCategories.js';
import { useListParams } from '@/hooks/useListParams.js';
import { useAuthStore } from '@/stores/authStore.js';
import {
  classifyProduct,
  parseHiddenColumns,
  serializeHiddenColumns,
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

// Colonne de `ProductsTable` → valeur triée. Les clés sont les identifiants de
// colonne : ce qui n'est pas ici n'est pas triable, et l'entête ne se présente
// pas comme cliquable. `type`, `status` et `margin` sont laissés de côté — un
// classement par badge ou par marge dérivée ne répond à aucune question de
// catalogue que le filtre ne traite pas mieux.
const PRODUCT_SORTS: Record<string, (r: ProductRow) => string | number> = {
  product:  (r) => r.name,
  sku:      (r) => r.sku,
  category: (r) => r.category_name ?? '',
  cost:     (r) => r.cost_price,
  retail:   (r) => r.retail_price,
  stock:    (r) => r.current_stock,
};

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
  // filtre ET remettre la page à 1 d'un seul mouvement. Le bloc vit désormais
  // dans `useListParams` (il était dupliqué mot pour mot avec OrdersListPage) ;
  // les deux pièges qu'il ferme y sont gravés.
  const [params, patchParams] = useListParams();

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
  // Le tri rejoint l'état de liste déjà porté par l'URL (recherche, catégorie,
  // vue, page) : il se partage par lien et survit au retour arrière. Une clé
  // inconnue retombe sur l'ordre naturel plutôt que de trier au hasard.
  const sortParam     = params.get('sort') ?? '';
  const sortCol       = Object.hasOwn(PRODUCT_SORTS, sortParam) ? sortParam : null;
  const sortDir: 'asc' | 'desc' = params.get('dir') === 'desc' ? 'desc' : 'asc';

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
    patchParams({ rows: next === LIST_PAGE_SIZE_DEFAULT ? null : String(next), page: null });
  };
  // Trier renvoie en page 1 : la page 7 d'un ordre qui vient de changer est une
  // tranche arbitraire du nouveau classement.
  const setSort = (columnId: string, direction: 'asc' | 'desc'): void => {
    patchParams({ sort: columnId, dir: direction === 'asc' ? null : 'desc', page: null });
  };

  // Le défaut n'est pas « tout montrer » : onze colonnes débordent des 1219 px
  // utiles d'un 1280. `type` s'ouvre masquée — voir le pourquoi du choix sur
  // PRODUCT_DEFAULT_HIDDEN_COLUMNS. Le menu Columns la rend en un clic.
  //
  // Le choix REJOINT l'URL (`?hide=`), dernier état de liste qui lui échappait.
  // Le sentinel `none` distingue « je n'ai rien choisi » de « j'ai tout
  // affiché » — sans lui, le défaut écraserait au retour le choix de celui qui
  // vient de rappeler la colonne `type`. Voir `parseHiddenColumns`.
  const hiddenColumns = useMemo(
    () => parseHiddenColumns(params.get('hide')),
    [params],
  );
  const [showNew, setShowNew] = useState(false);
  const [toDelete, setToDelete] = useState<ProductRow | null>(null);

  // Deep-link `/backoffice/products/new` → `?new=1` : ouvre la modale de
  // création au montage puis retire le paramètre pour qu'un rechargement ou un
  // partage d'URL ne la rouvre pas. Silencieux si l'opérateur n'a pas le droit
  // de créer — le paramètre est nettoyé sans ouvrir quoi que ce soit.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (canCreate) setShowNew(true);
    patchParams({ new: null });
  }, [params, canCreate, patchParams]);

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

  // Le tri vit ICI et non dans `ProductsTable` : la table et la grille montrent
  // le même jeu, donc trier dans la table seule ferait diverger les deux vues —
  // le défaut de parité que la pagination partagée vient de fermer.
  //
  // Tri CLIENT assumé : `useProducts` charge tout le catalogue (le filtrage
  // ci-dessus est déjà en mémoire), il n'y a pas de tranche serveur à trier.
  const sorted = useMemo(() => {
    if (sortCol === null) return filtered;
    const pick = PRODUCT_SORTS[sortCol];
    if (pick === undefined) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    // `Array.prototype.sort` est STABLE (ES2019) : à valeur égale les lignes
    // gardent leur ordre d'arrivée, donc la liste ne se réarrange pas toute
    // seule entre deux rendus. On trie une COPIE — `filtered` est mémoïsé et
    // partagé.
    return [...filtered].sort((a, b) => {
      const va = pick(a);
      const vb = pick(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'id-ID', { numeric: true }) * dir;
    });
  }, [filtered, sortCol, sortDir]);

  // Masquer/afficher une colonne ne touche PAS la page : la tranche de lignes
  // est la même, seules ses colonnes changent.
  function toggleColumn(id: ProductColumnId): void {
    const next = new Set(hiddenColumns);
    if (next.has(id)) next.delete(id); else next.add(id);
    patchParams({ hide: serializeHiddenColumns(next) });
  }

  function openProduct(row: ProductRow): void {
    void navigate(`/backoffice/products/${row.id}`);
  }

  function openPricing(row: ProductRow): void {
    void navigate(`/backoffice/products/${row.id}?tab=general`);
  }

  // Le RETOUR ANTICIPÉ sur erreur est retiré. Il faisait disparaître la page
  // entière — fil d'Ariane, titre, onglets, bande de compteurs — pour un
  // rafraîchissement raté : l'opérateur perdait jusqu'à l'endroit où il se
  // trouvait, et n'avait d'autre issue qu'un rechargement qui lui coûtait ses
  // filtres. Le bandeau SURPLOMBE désormais la table (patron d'OrdersListPage),
  // et les lignes déjà chargées restent lisibles.
  const productsError = products.error ?? null;

  // 13 px de gouttière, le module de DESIGN.md, appliqué par toute la flotte
  // (OrdersListPage, ZReportsListPage, CustomersListPage, Inventory). Cette
  // page était la seule à 14 px (`space-y-3.5`).
  return (
    <div className="flex flex-col gap-[13px]">
      <ProductsHeader
        count={kpis.total}
        isLoading={products.isLoading}
        canCreate={canCreate}
        canImport={canImport}
        onNew={() => { setShowNew(true); }}
        onImport={() => { void navigate('/backoffice/products/import-export'); }}
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

      <ListCounterStrip
        counters={buildProductCounters(
          kpis,
          counter,
          (next) => { setCounterParam(next); },
          products.isLoading,
        )}
        activeId={counter}
        ariaLabel="Catalog filters"
        // Sept compteurs — plus que les cinq ou six des autres listes : la
        // bande s'autorise à passer à la ligne plutôt qu'à se faire rogner.
        className="flex-wrap"
        data-testid="products-counter-strip"
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

      {productsError !== null && (
        <QueryErrorBanner
          detail={productsError.message}
          onRetry={() => { void products.refetch(); }}
          data-testid="products-error"
        >
          The catalogue could not be loaded — the rows below may be out of date.
        </QueryErrorBanner>
      )}

      {/* Erreur ET aucune ligne : on ne rend pas la table, dont l'état vide
          dirait « aucun produit ne correspond à ces filtres » — une phrase
          fausse quand c'est la requête qui a échoué. Même garde
          qu'OrdersListPage. */}
      {(productsError === null || rows.length > 0) && (
        view === 'list' ? (
          <ProductsTable
            rows={sorted}
            isLoading={products.isLoading}
            parentIds={parentIds}
            hiddenColumns={hiddenColumns}
            page={page}
            onPage={setPage}
            pageSize={pageSize}
            onPageSize={setPageSize}
            sort={sortCol === null ? null : { columnId: sortCol, direction: sortDir }}
            onSortChange={(next) => { setSort(next.columnId, next.direction); }}
            onRowClick={openProduct}
            onView={openProduct}
            {...(canEditPricing ? { onPricing: openPricing } : {})}
            {...(canDelete ? { onDelete: (row: ProductRow) => { setToDelete(row); } } : {})}
          />
        ) : (
          <ProductsGrid
            rows={sorted}
            parentIds={parentIds}
            onCardClick={openProduct}
            page={page}
            onPage={setPage}
            pageSize={pageSize}
            onPageSize={setPageSize}
          />
        )
      )}
    </div>
  );
}
