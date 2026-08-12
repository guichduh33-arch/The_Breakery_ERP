// apps/backoffice/src/features/products/components/ProductsGrid.tsx
//
// Session 14 / Phase 4.B — Card grid view of the catalog.
// Used when the user toggles to "grid" view from the filter strip.
//
// La grille recevait tout le résultat filtré et rendait ses 373 cartes d'un
// coup, quand la table voisine paginait à 15 : basculer de vue faisait passer
// le document de 911 à 8 236 nœuds. Elle prend désormais le MÊME contrat que
// `ProductsTable` — `page`, `pageSize`, `onPage`, `onPageSize` — et le même
// pied, pour qu'un bouton de vue ne change plus que l'apparence.

import { ImageOff } from 'lucide-react';
import type { JSX } from 'react';
import { Badge, Card, CardContent, Currency } from '@breakery/ui';
import { CategoryChip } from './CategoryChip.js';
import { ProductTypeBadge } from './ProductTypeBadge.js';
import {
  PRODUCTS_PAGE_SIZE_DEFAULT,
  ProductsPagination,
  pageSlice,
} from './ProductsPagination.js';
import { classifyProduct, type ProductRow } from '../types.js';
import { formatCurrency } from '@breakery/utils';

interface Props {
  rows: readonly ProductRow[];
  /** Session 27c — set of product ids that are parents (i.e. have variants). */
  parentIds?: ReadonlySet<string>;
  onCardClick?: (row: ProductRow) => void;
  /** Page courante, 1-based — même contrat que ProductsTable. */
  page?: number;
  onPage?: (next: number) => void;
  pageSize?: number;
  onPageSize?: (next: number) => void;
}

export function ProductsGrid({
  rows,
  parentIds,
  onCardClick,
  page = 1,
  onPage,
  pageSize = PRODUCTS_PAGE_SIZE_DEFAULT,
  onPageSize,
}: Props): JSX.Element {
  const { pageRows } = pageSlice(rows, page, pageSize);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated py-16 text-center">
        <h3 className="text-xl font-semibold text-text-primary">No products to show</h3>
        <p className="mt-1 text-sm text-text-secondary">Try adjusting your filters.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3.5" data-testid="products-grid">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {pageRows.map((r) => (
        <Card
          key={r.id}
          variant="default"
          // Polish — Border-Before-Shadow : une carte de grille ne quitte pas le
          // plan de la page, elle n'a donc pas à dépenser une ombre pour se
          // distinguer. Le survol se dit par la bordure, comme partout ailleurs.
          className="group cursor-pointer overflow-hidden border-border-subtle transition-colors duration-base hover:border-border-strong"
          onClick={() => onCardClick?.(r)}
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-bg-overlay">
            {r.image_url === null ? (
              <div className="flex h-full w-full items-center justify-center text-text-muted">
                <ImageOff className="h-8 w-8" aria-hidden />
              </div>
            ) : (
              <img
                src={r.image_url}
                alt={r.name}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-base group-hover:scale-[1.02]"
              />
            )}
            {!r.is_active && (
              <span className="absolute left-2 top-2 rounded-sm bg-red-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red">
                Inactive
              </span>
            )}
          </div>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="line-clamp-1 text-base font-semibold text-text-primary">{r.name}</h3>
              <Currency format={formatCurrency} amount={r.retail_price} emphasis="gold" />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-text-muted">{r.sku}</span>
              {r.category_name !== null && <CategoryChip name={r.category_name} />}
            </div>
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <ProductTypeBadge type={classifyProduct(r)} />
              {r.parent_product_id !== null && (
                <Badge variant="outline" data-testid="badge-variant">Variant</Badge>
              )}
              {parentIds !== undefined && parentIds.has(r.id) && (
                <Badge variant="outline" data-testid="badge-parent">Parent</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
      <ProductsPagination
        total={rows.length}
        page={page}
        pageSize={pageSize}
        {...(onPage !== undefined ? { onPage } : {})}
        {...(onPageSize !== undefined ? { onPageSize } : {})}
      />
    </div>
  );
}
