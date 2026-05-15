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
import { ComboBadge } from '@/features/combos/components/ComboBadge';
import { ProductCard } from './ProductCard';
import { useProducts } from './hooks/useProducts';
import { useCategories } from './hooks/useCategories';
import { useActiveLotsByProduct } from './hooks/useActiveLotsByProduct';

export interface ProductGridProps {
  selectedSlug: string | null;
  onSelect: (product: Product) => void;
}

export function ProductGrid({ selectedSlug, onSelect }: ProductGridProps): JSX.Element {
  const { data: products = [], isLoading } = useProducts();
  const { data: categories = [] } = useCategories();
  const { data: lotsByProduct } = useActiveLotsByProduct();
  const [query, setQuery] = useState('');

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
        if (!selectedCat || p.category_id !== selectedCat.id) return false;
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
        <h1 className="font-display text-xl text-text-primary capitalize">
          {title}
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
            className="pl-9 h-9 bg-bg-base border-border-subtle rounded-md text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="text-text-secondary">Loading products…</div>
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
          <div className="grid grid-cols-4 gap-4">
            {filtered.map((p) => {
              const soldOut = p.current_stock <= 0;
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

              return (
                <ProductCard
                  key={p.id}
                  product={p}
                  disabled={disabled}
                  overlayLabel={overlayLabel}
                  lowStockLabel={lowStockLabel}
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
