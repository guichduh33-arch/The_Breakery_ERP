// apps/pos/src/features/products/ProductCard.tsx
//
// Session 14 — Phase 2.A — Single tile in the POS ProductGrid.
//
// Visual reference: docs/Design/caissapp/01-grid-bagel-empty-cart-dine-in.jpg
// + 03-grid-coffee-empty-cart.jpg + 06-grid-bread-takeout-promo-badges.jpg.
//
// Layout (per refs):
//   ┌───────────────────────────────┐
//   │ [Promo]              [Star ☆] │ ← top overlay row (promo top-left, fav top-right)
//   │                               │
//   │       <product image>         │ ← aspect-square cover, fallback BrandMark
//   │                               │
//   │  ───────────────────────────  │
//   │  LOW STOCK · 2 LEFT           │ ← optional ribbon overlay at image bottom
//   └───────────────────────────────┘
//   │ Product name                  │ ← Inter sm
//   │ Rp 70,000                     │ ← JetBrains Mono gold
//   └───────────────────────────────┘
//
// "Out of stock" state (refs 03/06): faded image overlay + tilted "SOLD OUT"
// label rotated -15deg. Item still tappable? Per ref 06 the SOLD OUT items
// don't have prices visible underneath → they're disabled (we keep that
// behaviour — disabled, opacity 50%, cursor not-allowed).
//
// Promo badge (ref 06): top-left, gold text "PROMO" with subtle gold-soft
// background. Caller passes `promoActive` boolean; future enhancement may
// expose `promoLabel` for richer text.

import { Star } from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';
import { Currency, BrandMark, AllergenBadge, cn, type AllergenType } from '@breakery/ui';
import type { Product } from '@breakery/domain';

export interface ProductCardProps {
  product: Product;
  /** Disable the card (sold out / expired / loading). */
  disabled?: boolean;
  /** Reason label shown over the image when disabled — "Sold out", "Expired". */
  overlayLabel?: string | null;
  /** Show a promo badge top-left. */
  promoActive?: boolean;
  /** Low-stock indicator (ref 06 — "LOW STOCK · 2 LEFT"). */
  lowStockLabel?: string | null;
  /** Resolved allergens (own + cascade) — Session 15 Phase 5.C. */
  allergens?: ReadonlyArray<AllergenType>;
  /** Click handler (skipped when disabled). */
  onSelect: (product: Product) => void;
  /** Optional extra slot rendered top-left ABOVE the image (e.g. ComboBadge). */
  topLeftSlot?: ReactNode;
}

export function ProductCard({
  product,
  disabled = false,
  overlayLabel = null,
  promoActive = false,
  lowStockLabel = null,
  allergens,
  onSelect,
  topLeftSlot,
}: ProductCardProps): JSX.Element {
  const allergenList = allergens ?? [];
  // P1 #6 — fall back to the BrandMark placeholder when image_url is absent OR
  // fails to load (broken/404 URL), instead of showing a broken-image icon.
  const [imgError, setImgError] = useState(false);
  const showImage = !!product.image_url && !imgError;
  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(product)}
      disabled={disabled}
      data-testid={`product-card-${product.id}`}
      aria-label={`${product.name} — ${disabled && overlayLabel ? overlayLabel : 'tap to add'}`}
      className={cn(
        'group relative bg-bg-elevated rounded-lg overflow-hidden border border-border-subtle text-left will-change-transform',
        'transition-[transform,box-shadow,border-color,background-color] duration-fast ease-motion-out',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
        'focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-2',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer hover:-translate-y-0.5 hover:border-border-strong hover:bg-bg-overlay hover:shadow-lg active:scale-[0.97] active:translate-y-0 active:shadow-md',
      )}
    >
      <div className="relative aspect-square bg-bg-input overflow-hidden">
        {showImage ? (
          <img
            src={product.image_url ?? undefined}
            alt=""
            loading="lazy"
            onError={() => setImgError(true)}
            className={cn(
              'object-cover w-full h-full transition-transform duration-slow ease-motion-out motion-reduce:transition-none',
              disabled ? 'grayscale' : 'group-hover:scale-[1.06]',
            )}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <BrandMark size="lg" className="opacity-50" />
          </div>
        )}

        {/* Top-left slot — promo badge, combo badge, etc. */}
        {(promoActive || topLeftSlot) && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5 z-10">
            {promoActive && <PromoBadge />}
            {topLeftSlot}
          </div>
        )}

        {/* Favorite star top-right */}
        <span
          aria-hidden
          className={cn(
            'absolute top-2 right-2 inline-flex items-center justify-center h-7 w-7 rounded-full bg-bg-base/40 backdrop-blur-sm z-10',
          )}
        >
          <Star
            className={cn(
              'h-4 w-4',
              product.is_favorite ? 'fill-gold text-gold' : 'text-text-muted',
            )}
            aria-hidden
          />
        </span>

        {/* Out-of-stock / disabled overlay */}
        {overlayLabel && (
          <div className="absolute inset-0 grid place-items-center bg-bg-base/55 z-20">
            <span className="rotate-[-12deg] bg-bg-base/85 px-3 py-1 rounded-sm text-text-muted text-xs font-bold uppercase tracking-widest border border-border-strong">
              {overlayLabel}
            </span>
          </div>
        )}

        {/* Allergen badges — bottom-right overlay (Session 15 Phase 5.C) */}
        {allergenList.length > 0 && (
          <div
            className="absolute bottom-1 right-1 flex flex-wrap justify-end gap-0.5 max-w-[70%] z-10"
            data-testid={`product-card-allergens-${product.id}`}
          >
            {allergenList.map((a) => (
              <AllergenBadge key={a} allergen={a} size="sm" />
            ))}
          </div>
        )}

        {/* Low-stock ribbon at image bottom */}
        {!disabled && lowStockLabel && (
          <div className="absolute inset-x-0 bottom-0 bg-bg-base/70 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-warn font-semibold z-10 text-center">
            {lowStockLabel}
          </div>
        )}
      </div>

      <div className="px-3 py-2.5 space-y-0.5">
        <div className="text-sm text-text-primary truncate" title={product.name}>
          {product.name}
        </div>
        <Currency
          amount={product.retail_price}
          emphasis="gold"
          className="text-xs font-mono"
        />
      </div>
    </button>
  );
}

function PromoBadge(): JSX.Element {
  return (
    <span
      data-testid="product-card-promo-badge"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-gold-soft text-gold border border-gold/30"
    >
      <span aria-hidden>%</span>
      Promo
    </span>
  );
}
