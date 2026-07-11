// apps/pos/src/features/products/ProductGrid.tsx
//
// Session 14 — Phase 2.A — POS product grid (middle column).
//
// Visual reference: docs/Design/caissapp/01-grid-bagel-empty-cart-dine-in.jpg
// + 02-grid-beverage-subcategory-landing.jpg + 03-grid-coffee-empty-cart.jpg
// + 06-grid-bread-takeout-promo-badges.jpg.
//
// Layout (per refs):
//   ┌─────────────────────────────────────────────────────────┐
//   │  Category Title (Playfair)       [🔍 Search...  ]      │  ← top bar
//   ├─────────────────────────────────────────────────────────┤
//   │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                       │
//   │  │     │ │     │ │     │ │     │   ← 4-column grid     │
//   │  └─────┘ └─────┘ └─────┘ └─────┘                       │
//   │  ...                                                   │
//   └─────────────────────────────────────────────────────────┘
//
// Search filters by name (case-insensitive). Branded EmptyState when no
// matches OR no products in category.

import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Search } from 'lucide-react';
import type { Product } from '@breakery/domain';
import { allLotsExpiredOrConsumed } from '@breakery/domain';
import { EmptyState, Input } from '@breakery/ui';
import { ErrorState } from '@/components/ErrorState';
import { ComboBadge } from '@/features/combos/components/ComboBadge';
import { useCartStore } from '@/stores/cartStore';
import { ProductCard } from './ProductCard';
import { useProducts } from './hooks/useProducts';
import { useCategories } from './hooks/useCategories';
import { useActiveLotsByProduct } from './hooks/useActiveLotsByProduct';
import { useProductAllergensMap } from './hooks/useProductAllergens';

export interface ProductGridProps {
  selectedSlug: string | null;
  onSelect: (product: Product) => void;
}

/** Stable identity for the empty-cart fallback (avoids selector re-render loops). */
const EMPTY_ITEMS: never[] = [];

export function ProductGrid({ selectedSlug, onSelect }: ProductGridProps): JSX.Element {
  const { data: products = [], isLoading, isError, refetch } = useProducts();
  const { data: categories = [] } = useCategories();
  const { data: lotsByProduct } = useActiveLotsByProduct();
  const { data: allergensByProduct } = useProductAllergensMap();
  // Stable empty fallback so a partially-mocked store (tests) can't crash here
  // and the selector never returns a fresh array identity.
  const cartItems = useCartStore((s) => s.cart?.items ?? EMPTY_ITEMS);
  const [query, setQuery] = useState('');

  // Per-product quantity currently on the ticket → the in-cart badge (#9).
  const qtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of cartItems) {
      if (it.is_cancelled) continue;
      m.set(it.product_id, (m.get(it.product_id) ?? 0) + it.quantity);
    }
    return m;
  }, [cartItems]);

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 flex items-center justify-between gap-4 border-b border-border-subtle">
        {/* Functional title (not the decorative serif that duplicated the rail
            active state, #11): plain heading + live item count. */}
        <h1 className="flex items-baseline gap-2 min-w-0">
          <span className="text-lg font-semibold text-text-primary truncate">{title}</span>
          {!isLoading && !isError && (
            <span className="shrink-0 font-mono tabular-nums text-sm text-text-muted">
              {filtered.length}
            </span>
          )}
        </h1>
        <div className="relative w-72">
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            aria-label="Search products"
            className="pl-9 h-11 bg-bg-base border-border-subtle rounded-md text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isError ? (
          <ErrorState
            title="Impossible de charger les produits"
            description="Le catalogue n'a pas pu être récupéré. Vérifiez la connexion et réessayez."
            onRetry={() => void refetch()}
          />
        ) : isLoading ? (
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3"
            aria-busy="true"
            aria-label="Loading products"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
            {filtered.map((p) => {
              // S43 (P1-1) — sold-out is derived in useProducts via the domain
              // isSellable rule (track_inventory + display_stock-first).
              const soldOut = p.is_sellable === false;
              const lots = lotsByProduct?.get(p.id);
              const isLotTracked = lots !== undefined && lots.length > 0;
              const allExpired = isLotTracked && allLotsExpiredOrConsumed(lots, p.id);
              const disabled = soldOut || allExpired;
              const overlayLabel = soldOut
                ? 'Sold out'
                : allExpired
                  ? 'Expired'
                  : null;
              // Low-stock heuristic — current_stock > 0 && <= 3 (matches ref 06 "LOW STOCK · 2 LEFT").
              const lowStockLabel =
                !disabled && p.current_stock > 0 && p.current_stock <= 3
                  ? `Low stock · ${p.current_stock} left`
                  : null;

              const allergens = allergensByProduct?.get(p.id) ?? [];

              return (
                <ProductCard
                  key={p.id}
                  product={p}
                  disabled={disabled}
                  overlayLabel={overlayLabel}
                  lowStockLabel={lowStockLabel}
                  allergens={allergens}
                  cartQty={qtyByProduct.get(p.id) ?? 0}
                  onSelect={onSelect}
                  topLeftSlot={
                    p.product_type === 'combo' ? <ComboBadge /> : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Loading placeholder mirroring ProductCard's shape (image + name + price). */
function ProductCardSkeleton(): JSX.Element {
  return (
    <div
      aria-hidden
      className="rounded-lg overflow-hidden border border-border-subtle bg-bg-elevated motion-safe:animate-pulse"
    >
      <div className="aspect-[4/3] bg-bg-input" />
      <div className="px-2.5 py-2 space-y-2">
        <div className="h-3.5 w-3/4 rounded bg-bg-input" />
        <div className="h-3.5 w-1/3 rounded bg-bg-input" />
      </div>
    </div>
  );
}
