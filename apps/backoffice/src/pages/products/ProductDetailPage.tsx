// apps/backoffice/src/pages/products/ProductDetailPage.tsx
//
// Session 14 / Phase 4.B — Product detail page (read-only baseline).
// Session 27 — Wave 2 — Wired the Save button to update_product_v2 RPC. The
// General tab now tracks a controlled draft + dirty flag; clicking Save fires
// the JSONB patch and the page refetches on success.
//
// URL: /backoffice/products/:productId

import { Suspense, lazy, useEffect, useMemo, useState, type JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { ProductDetailHeader } from '@/features/products/components/ProductDetailHeader.js';
import {
  ProductDetailTabs,
  productTabId,
  productTabPanelId,
} from '@/features/products/components/ProductDetailTabs.js';
import { useCategories } from '@/features/products/hooks/useCategories.js';
import { useProductDetail } from '@/features/products/hooks/useProductDetail.js';
import { useProductDisplayStock } from '@/features/products/hooks/useProductDisplayStock.js';
import { useUpdateProduct, type ProductUpdatePatch } from '@/features/products/hooks/useUpdateProduct.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { ProductDetailTab, ProductRow } from '@/features/products/types.js';

// Optimize — les neuf panneaux étaient importés statiquement, et le chunk de
// cette page pesait 123 kB (30,8 kB gzip) : le plus gros chunk de page de
// l'application, 2,6× le suivant. Ouvrir une fiche pour corriger un prix
// téléchargeait le constructeur de recettes, le tableau des variantes, la
// grille des modificateurs et le journal — huit panneaux qu'on n'ouvrira
// peut-être jamais.
//
// Un seul onglet est monté à la fois : le découpage suit donc exactement l'usage.
// `RecipeBuilder` passe par un barrel, d'où la projection sur `default`.
const GeneralPanel   = lazy(() => import('@/features/products/components/GeneralPanel.js').then((m) => ({ default: m.GeneralPanel })));
const UnitsPanel     = lazy(() => import('@/features/products/components/UnitsPanel.js').then((m) => ({ default: m.UnitsPanel })));
const VariantsPanel  = lazy(() => import('@/features/products/components/VariantsPanel.js').then((m) => ({ default: m.VariantsPanel })));
const ModifiersPanel = lazy(() => import('@/features/products/components/ModifiersPanel.js').then((m) => ({ default: m.ModifiersPanel })));
const CostingPanel   = lazy(() => import('@/features/products/components/CostingPanel.js').then((m) => ({ default: m.CostingPanel })));
const PurchasePanel  = lazy(() => import('@/features/products/components/PurchasePanel.js').then((m) => ({ default: m.PurchasePanel })));
const StationsPanel  = lazy(() => import('@/features/products/components/StationsPanel.js').then((m) => ({ default: m.StationsPanel })));
const HistoryPanel   = lazy(() => import('@/features/products/components/HistoryPanel.js').then((m) => ({ default: m.HistoryPanel })));
const RecipeBuilder  = lazy(() => import('@/features/recipes/index.js').then((m) => ({ default: m.RecipeBuilder })));

// ADR-011 §3 — 'modifiers' manquait : un deep-link ?tab=modifiers retombait
// silencieusement sur l'onglet par défaut. ('analytics' reste exclu : le type le
// déclare mais la page ne rend aucun panel pour cet onglet.)
//
// Distill — 'overview' est retiré. Un lien ?tab=overview encore en circulation
// n'échoue pas : il ne passe pas le garde et retombe sur General, qui affichait
// déjà tout ce que l'ancien onglet montrait de vrai.
const VALID_TABS: ReadonlySet<ProductDetailTab> = new Set([
  'general', 'units', 'recipe', 'variants', 'modifiers', 'costing', 'purchase', 'stations', 'history',
]);

const DEFAULT_TAB: ProductDetailTab = 'general';

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
  // Harden — l'onglet actif vit dans l'URL, comme le compteur de la liste
  // (`Products.tsx`). La lecture unique au montage cassait trois gestes natifs :
  // F5 renvoyait sur le premier onglet, Retour éjectait de la fiche, et le
  // deep-link `$` de la liste devenait faux dès le premier clic d'onglet.
  // `useUrlState` pose `replace: true` (pas neuf entrées d'historique pour neuf
  // onglets) et efface le paramètre quand il vaut le défaut, donc General garde
  // une URL propre.
  const [tabParam, setTabParam] = useUrlState('tab', DEFAULT_TAB);
  const tab: ProductDetailTab = VALID_TABS.has(tabParam as ProductDetailTab)
    ? (tabParam as ProductDetailTab)
    : DEFAULT_TAB;
  const setTab = (next: ProductDetailTab): void => { setTabParam(next); };
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
        Failed to load product: {(product.error).message}
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
      <div className="flex justify-end">
        <Link
          to={`/backoffice/inventory/${p.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-text-secondary transition-colors hover:border-gold-soft hover:text-gold"
        >
          <BarChart3 className="h-3.5 w-3.5" aria-hidden /> View stock analytics
        </Link>
      </div>

      <ProductDetailTabs active={tab} onChange={setTab} />

      <div
        role="tabpanel"
        id={productTabPanelId(tab)}
        aria-labelledby={productTabId(tab)}
        tabIndex={0}
        data-testid={`product-tab-${tab}`}
      >
        {/* Le repli tient la hauteur d'un panneau le temps du chargement du
            chunk : sans lui, la page se replierait sur son bandeau puis se
            redéploierait, et ce saut coûterait plus cher en confort que le
            téléchargement ne gagne. Squelette en papier pressé, comme partout. */}
        <Suspense fallback={<PanelFallback />}>
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
        {tab === 'modifiers' && <ModifiersPanel product={{ id: p.id }} />}
        {tab === 'costing' && (
          <CostingPanel product={p} />
        )}
        {tab === 'purchase' && <PurchasePanel productId={p.id} />}
        {tab === 'stations' && <StationsPanel product={p} />}
        {tab === 'history' && <HistoryPanel productId={p.id} />}
        </Suspense>
      </div>
    </div>
  );
}

function PanelFallback(): JSX.Element {
  return (
    <div className="space-y-3" data-testid="product-panel-fallback" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded bg-surface-4 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
