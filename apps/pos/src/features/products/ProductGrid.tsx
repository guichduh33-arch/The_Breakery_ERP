// apps/pos/src/features/products/ProductGrid.tsx
import { Currency, cn } from '@breakery/ui';
import { Star } from 'lucide-react';
import type { Product } from '@breakery/domain';
import { allLotsExpiredOrConsumed } from '@breakery/domain';
import { ComboBadge } from '@/features/combos/components/ComboBadge';
import { useProducts } from './hooks/useProducts';
import { useCategories } from './hooks/useCategories';
import { useActiveLotsByProduct } from './hooks/useActiveLotsByProduct';

export interface ProductGridProps {
  selectedSlug: string | null;
  onSelect: (product: Product) => void;
}

export function ProductGrid({ selectedSlug, onSelect }: ProductGridProps) {
  const { data: products = [], isLoading } = useProducts();
  const { data: categories = [] } = useCategories();
  const { data: lotsByProduct } = useActiveLotsByProduct();
  const selectedCat = categories.find((c) => c.slug === selectedSlug);
  const filtered = products.filter((p) => {
    if (selectedSlug === 'favorites') return p.is_favorite;
    if (!selectedCat) return true;
    return p.category_id === selectedCat.id;
  });

  if (isLoading) return <div className="p-6 text-text-secondary">Loading products…</div>;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-4 gap-4">
        {filtered.map((p) => {
          const soldOut = p.current_stock <= 0;
          // F1: lot-tracked product whose every active lot is expired/consumed → disable.
          const lots = lotsByProduct?.get(p.id);
          const isLotTracked = lots !== undefined && lots.length > 0;
          const allExpired = isLotTracked && allLotsExpiredOrConsumed(lots, p.id);
          const disabled = soldOut || allExpired;
          const overlayLabel = soldOut ? 'Sold out' : allExpired ? 'Expired' : null;
          return (
            <button
              key={p.id}
              onClick={() => !disabled && onSelect(p)}
              disabled={disabled}
              className={cn(
                'bg-bg-elevated rounded-lg overflow-hidden border border-border-subtle text-left transition-colors',
                disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-border-strong cursor-pointer',
              )}
            >
              <div className="relative aspect-square bg-bg-input">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="object-cover w-full h-full" />
                ) : null}
                {p.is_favorite && (
                  <Star className="absolute top-2 right-2 h-4 w-4 fill-gold text-gold" aria-hidden />
                )}
                {p.product_type === 'combo' && (
                  <ComboBadge className="absolute top-2 left-2" />
                )}
                {overlayLabel && (
                  <div className="absolute inset-0 grid place-items-center bg-bg-base/70 text-text-muted uppercase tracking-widest text-sm">
                    {overlayLabel}
                  </div>
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="text-sm">{p.name}</div>
                <Currency amount={p.retail_price} emphasis="gold" className="text-sm" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
