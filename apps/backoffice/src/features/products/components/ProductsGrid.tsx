// apps/backoffice/src/features/products/components/ProductsGrid.tsx
//
// Session 14 / Phase 4.B — Card grid view of the catalog.
// Used when the user toggles to "grid" view from the filter strip.

import { ImageOff } from 'lucide-react';
import type { JSX } from 'react';
import { Card, CardContent, Currency } from '@breakery/ui';
import { CategoryChip } from './CategoryChip.js';
import { ProductTypeBadge } from './ProductTypeBadge.js';
import { classifyProduct, type ProductRow } from '../types.js';

interface Props {
  rows: ReadonlyArray<ProductRow>;
  onCardClick?: (row: ProductRow) => void;
}

export function ProductsGrid({ rows, onCardClick }: Props): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated py-16 text-center">
        <h3 className="font-display italic text-xl text-text-primary">No products to show</h3>
        <p className="mt-1 text-sm text-text-secondary">Try adjusting your filters.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((r) => (
        <Card
          key={r.id}
          variant="default"
          className="group cursor-pointer overflow-hidden hover:shadow-md transition-shadow duration-base"
          onClick={() => onCardClick?.(r)}
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-bg-overlay">
            {r.image_url === null ? (
              <div className="flex h-full w-full items-center justify-center text-text-muted">
                <ImageOff className="h-8 w-8" aria-hidden />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.image_url}
                alt={r.name}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-base group-hover:scale-[1.02]"
              />
            )}
            {!r.is_active && (
              <span className="absolute left-2 top-2 rounded-full bg-red-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red">
                Inactive
              </span>
            )}
          </div>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-base text-text-primary line-clamp-1">{r.name}</h3>
              <Currency amount={r.retail_price} emphasis="gold" />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-text-muted">{r.sku}</span>
              {r.category_name !== null && <CategoryChip name={r.category_name} />}
            </div>
            <div className="pt-1">
              <ProductTypeBadge type={classifyProduct(r)} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
