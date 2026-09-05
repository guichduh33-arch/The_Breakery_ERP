// apps/pos/src/features/tablet/components/TabletProductGrid.tsx
//
// LOT 6 (POS P0 hardening, audit 2026-06-25) — iPad-first waiter product grid.
//
// Previously this just wrapped the cashier desktop ProductGrid (fixed 4 cols,
// h-9 search) which is cramped on a tablet held at arm's length. This is a
// dedicated grid: 2 columns in portrait / 3 in landscape (lg), a tall h-12
// search field, and the shared ProductCard tiles. The ModifierModal flow is
// unchanged.
//
// Lot D (2026-09-05) — la grille trie désormais le tap comme le comptoir
// (`ProductTapHandler`) : un produit désactivé ou un groupe de variantes est
// refusé avec un toast, un combo ouvre `ComboConfigModal` (et n'entre jamais
// dans le pipeline modificateurs ni dans l'auto-ajout), le reste garde le
// chemin existant. Jusqu'ici un combo tapé tombait dans l'auto-ajout nu et
// partait au serveur sans sa composition.

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, Input, ModifierModal, type ModifierModalProduct } from '@breakery/ui';
import { ErrorState } from '@/components/ErrorState';
import type { Product, SelectedModifiers } from '@breakery/domain';
import { allLotsExpiredOrConsumed } from '@breakery/domain';
import { ComboBadge } from '@/features/combos/components/ComboBadge';
import { ComboConfigModal } from '@/features/combos/components/ComboConfigModal';
import { ProductCard } from '@/features/products/ProductCard';
import { useProducts } from '@/features/products/hooks/useProducts';
import { useCategories } from '@/features/products/hooks/useCategories';
import { useActiveLotsByProduct } from '@/features/products/hooks/useActiveLotsByProduct';
import { useProductModifiers } from '@/features/products/hooks/useProductModifiers';
import { useTabletCartStore } from '@/stores/tabletCartStore';

export interface TabletProductGridProps {
  selectedSlug: string | null;
}

export function TabletProductGrid({ selectedSlug }: TabletProductGridProps): JSX.Element {
  const addItem = useTabletCartStore((s) => s.addItem);
  const addCombo = useTabletCartStore((s) => s.addCombo);
  const cartItems = useTabletCartStore((s) => s.items);
  const { data: products = [], isLoading, isError, refetch } = useProducts();
  const { data: categories = [] } = useCategories();
  const { data: lotsByProduct } = useActiveLotsByProduct();
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Product | null>(null);
  // Lot D — combo en cours de configuration. Un combo ne passe jamais par
  // `pending` : il n'a pas de groupe de modificateurs propre à résoudre.
  const [comboPending, setComboPending] = useState<Product | null>(null);

  // Critique 2026-08-24 (P1) — la tuile perdait son signal « déjà au panier »
  // sur la seule surface où la saisie est interrompue par le client qui parle.
  // Même dérivation que le comptoir (ProductGrid) : le badge doré coupe le
  // double-ajout, DESIGN.md § Product Tile.
  const qtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of cartItems) {
      m.set(it.product_id, (m.get(it.product_id) ?? 0) + it.quantity);
    }
    return m;
  }, [cartItems]);

  // Critique 2026-08-24 (P2) — la requête persistait en silence au changement
  // de catégorie tout en ne cherchant QUE dedans : « croissant » depuis Coffee
  // rendait « No matches » sur un produit qui existe. Changer de catégorie
  // repart d'une recherche vide.
  useEffect(() => {
    setQuery('');
  }, [selectedSlug]);

  const modifiersQuery = useProductModifiers({
    productId: pending?.id ?? '',
    categoryId: pending?.category_id ?? null,
    enabled: pending !== null,
  });

  const selectedCat = categories.find((c) => c.slug === selectedSlug);
  const title = selectedSlug === 'favorites'
    ? 'Favorites'
    : selectedSlug === 'combos'
      ? 'Combos'
      : selectedCat?.name ?? 'All';

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (selectedSlug === 'favorites' && !p.is_favorite) return false;
      if (selectedSlug === 'combos' && p.product_type !== 'combo') return false;
      if (selectedSlug && selectedSlug !== 'favorites' && selectedSlug !== 'combos') {
        if (p.category_id !== selectedCat?.id) return false;
      }
      if (query.trim().length > 0) {
        const q = query.trim().toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [products, selectedSlug, selectedCat, query]);

  // useCallback : identité stable pour préserver le React.memo de ProductCard —
  // sans quoi chaque frappe de recherche repasse toutes les tuiles visibles.
  const handleSelect = useCallback((product: Product) => {
    // ADR-022 déc. 3.2 — dernier filet avant l'entrée au panier, mêmes critères
    // que le comptoir (`ProductTapHandler.assertSellable`).
    if (!product.is_active) {
      toast.error(`${product.name} is disabled — it cannot be sold`);
      return;
    }
    // La tablette n'a pas de sélecteur de variante (suivi séparé) : un groupe
    // de variantes se traite au comptoir plutôt que d'entrer au panier tel quel.
    if (product.has_variants) {
      toast.error(`${product.name} is a variant group — pick a variant at the counter`);
      return;
    }
    // Lot D — un combo ouvre son configurateur, jamais le pipeline modificateurs.
    if (product.product_type === 'combo') {
      setComboPending(product);
      return;
    }
    setPending(product);
  }, []);

  function handleConfirm(selections: SelectedModifiers) {
    if (pending) addItem(pending, selections);
    setPending(null);
  }

  function handleClose() {
    setPending(null);
  }

  // Products with no modifier group add straight to the cart. Effet + ref, pas
  // le corps du render : `addItem` pendant le render est exactement le bug
  // StrictMode double-ajout que ProductTapHandler documente (Session 36) —
  // le queueMicrotask ne masquait que le setState, pas le double addItem.
  const autoAddedRef = useRef<Product | null>(null);
  useEffect(() => {
    if (!pending || !modifiersQuery.isSuccess) {
      autoAddedRef.current = null;
      return;
    }
    if (autoAddedRef.current === pending) return;
    if ((modifiersQuery.data ?? []).length === 0) {
      autoAddedRef.current = pending;
      addItem(pending, []);
      setPending(null);
    }
  }, [pending, modifiersQuery.isSuccess, modifiersQuery.data, addItem]);

  // Élément unique partagé par toutes les tuiles combo — un <ComboBadge />
  // créé dans le .map() casserait le memo de chaque tuile combo à chaque render
  // (même raison que dans ProductGrid).
  const comboBadge = useMemo(() => <ComboBadge />, []);

  const product: ModifierModalProduct | null = pending
    ? { id: pending.id, name: pending.name, retail_price: pending.retail_price }
    : null;
  const groups = modifiersQuery.data ?? [];
  const modalOpen = Boolean(product) && modifiersQuery.isSuccess && groups.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3 flex items-center justify-between gap-4 border-b border-border-subtle">
        {/* h2 — le h1 de la surface vit dans TabletLayout ; deux h1 simultanés
            cassaient la navigation par titres (a11y). */}
        <h2 className="font-sans font-semibold text-xl text-text-primary capitalize">{title}</h2>
        <div className="relative w-64">
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-text-muted pointer-events-none"
          />
          {/* h-12 search — comfortable to tap on a tablet (LOT 6). */}
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu..."
            aria-label="Search products"
            className="pl-10 h-12 bg-bg-base border-border-subtle rounded-md text-base"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {isError ? (
          <ErrorState
            title="Unable to load products"
            description="The menu could not be retrieved. Check your connection and try again."
            onRetry={() => void refetch()}
          />
        ) : isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading products">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                className="rounded-lg overflow-hidden border border-border-subtle bg-bg-elevated motion-safe:animate-pulse"
              >
                {/* 4/3 comme la vraie carte (ProductCard) — un squelette carré
                    provoquait un saut de mise en page au chargement. */}
                <div className="aspect-[4/3] bg-bg-input" />
                <div className="px-3 py-3 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-bg-input" />
                  <div className="h-3 w-1/3 rounded bg-bg-input" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            tone="branded"
            title={query.trim() ? 'No matches' : 'No products yet'}
            description={
              query.trim()
                ? `No products match "${query.trim()}".`
                : selectedSlug === 'favorites'
                  ? 'Mark products as favourite from the backoffice to pin them here.'
                  : 'Add products to this category from the backoffice.'
            }
            size="md"
          />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p) => {
              const soldOut = p.is_sellable === false;
              const lots = lotsByProduct?.get(p.id);
              const isLotTracked = lots !== undefined && lots.length > 0;
              const allExpired = isLotTracked && allLotsExpiredOrConsumed(lots, p.id);
              const disabled = soldOut || allExpired;
              const overlayLabel = soldOut ? 'Sold out' : allExpired ? 'Expired' : null;
              const lowStockLabel =
                !disabled && p.current_stock > 0 && p.current_stock <= 3
                  ? `Low stock · ${p.current_stock} left`
                  : null;

              return (
                <ProductCard
                  key={p.id}
                  product={p}
                  disabled={disabled}
                  overlayLabel={overlayLabel}
                  lowStockLabel={lowStockLabel}
                  cartQty={qtyByProduct.get(p.id) ?? 0}
                  onSelect={handleSelect}
                  topLeftSlot={p.product_type === 'combo' ? comboBadge : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      {product && (
        <ModifierModal
          open={modalOpen}
          product={product}
          groups={groups}
          onClose={handleClose}
          onConfirm={handleConfirm}
        />
      )}

      {/* Lot D — configurateur combo, miroir du comptoir (ProductTapHandler).
          La vendabilité est tranchée par handleSelect au tap et re-vérifiée à
          la confirmation, comme au comptoir ; les composants non vendables
          sont écartés en amont par useComboConfig. */}
      <ComboConfigModal
        open={comboPending !== null}
        product={comboPending ? { id: comboPending.id, name: comboPending.name } : null}
        onConfirm={({ components, modifiers, unitPrice }) => {
          if (comboPending) {
            if (comboPending.is_active) {
              addCombo(comboPending, modifiers, components, unitPrice);
            } else {
              toast.error(`${comboPending.name} is disabled — it cannot be sold`);
            }
          }
          setComboPending(null);
        }}
        onClose={() => setComboPending(null)}
      />
    </div>
  );
}
