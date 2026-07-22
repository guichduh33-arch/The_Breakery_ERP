// apps/pos/src/features/tablet/components/TabletProductGrid.tsx
//
// LOT 6 (POS P0 hardening, audit 2026-06-25) — iPad-first waiter product grid.
//
// Previously this just wrapped the cashier desktop ProductGrid (fixed 4 cols,
// h-9 search) which is cramped on a tablet held at arm's length. This is a
// dedicated grid: 2 columns in portrait / 3 in landscape (lg), a tall h-12
// search field, and the shared ProductCard tiles. The ModifierModal flow is
// unchanged.

import { useMemo, useState, type JSX } from 'react';
import { Search } from 'lucide-react';
import { EmptyState, Input, ModifierModal, type ModifierModalProduct } from '@breakery/ui';
import { ErrorState } from '@/components/ErrorState';
import type { Product, SelectedModifiers } from '@breakery/domain';
import { allLotsExpiredOrConsumed } from '@breakery/domain';
import { ComboBadge } from '@/features/combos/components/ComboBadge';
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
  const { data: products = [], isLoading, isError, refetch } = useProducts();
  const { data: categories = [] } = useCategories();
  const { data: lotsByProduct } = useActiveLotsByProduct();
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Product | null>(null);

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

  function handleSelect(product: Product) {
    setPending(product);
  }

  function handleConfirm(selections: SelectedModifiers) {
    if (pending) addItem(pending, selections);
    setPending(null);
  }

  function handleClose() {
    setPending(null);
  }

  // Products with no modifier group add straight to the cart.
  if (pending && modifiersQuery.isSuccess) {
    const groups = modifiersQuery.data;
    if (groups.length === 0) {
      addItem(pending, []);
      queueMicrotask(() => setPending(null));
    }
  }

  const product: ModifierModalProduct | null = pending
    ? { id: pending.id, name: pending.name, retail_price: pending.retail_price }
    : null;
  const groups = modifiersQuery.data ?? [];
  const modalOpen = Boolean(product) && modifiersQuery.isSuccess && groups.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3 flex items-center justify-between gap-4 border-b border-border-subtle">
        <h1 className="font-display text-xl text-text-primary capitalize">{title}</h1>
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
            title="Impossible de charger les produits"
            description="Le menu n'a pas pu être récupéré. Vérifiez la connexion et réessayez."
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
                <div className="aspect-square bg-bg-input" />
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
                  onSelect={handleSelect}
                  topLeftSlot={p.product_type === 'combo' ? <ComboBadge /> : undefined}
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
    </div>
  );
}
