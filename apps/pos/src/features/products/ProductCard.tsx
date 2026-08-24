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
//   │ Rp 70.000                     │ ← JetBrains Mono gold
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
import { memo, useState, type JSX, type ReactNode } from 'react';
import { Currency, BrandMark, cn } from '@breakery/ui';
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
  /** Quantity of this product currently in the ticket (0 = not added). */
  cartQty?: number;
  /** Click handler (skipped when disabled). */
  onSelect: (product: Product) => void;
  /** Optional extra slot rendered top-left ABOVE the image (e.g. ComboBadge). */
  topLeftSlot?: ReactNode;
}

function ProductCardImpl({
  product,
  disabled = false,
  overlayLabel = null,
  promoActive = false,
  lowStockLabel = null,
  cartQty = 0,
  onSelect,
  topLeftSlot,
}: ProductCardProps): JSX.Element {
  const inCart = cartQty > 0 && !disabled;
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
      // Critique run 4 lot 5 — l'aria-label recomposé effaçait le PRIX, la
      // valeur que la tuile promet de faire vérifier ; aria-labelledby recompose
      // le nom + le prix (ou l'état sold-out) depuis les éléments visibles.
      aria-labelledby={[
        `pc-name-${product.id}`,
        // Review de pile — pas de référence pendante : le prix n'existe que si
        // !disabled, l'overlay que s'il est fourni ; sinon le nom seul suffit.
        disabled ? (overlayLabel ? `pc-overlay-${product.id}` : null) : `pc-price-${product.id}`,
      ].filter(Boolean).join(' ')}
      className={cn(
        'group relative bg-bg-elevated rounded-lg overflow-hidden border text-left',
        // Perf (P2) — no permanent `will-change`, it pins a compositor layer
        // for every idle tile in the grid. Promote only while the browser is
        // actually about to animate the transform (hover/active).
        // Critique 2026-08-23 — tout le vocabulaire de survol est conditionné à
        // `(hover: hover)` : sur les surfaces tactiles (comptoir ET tablette),
        // :hover COLLE après un tap — une tuile restait soulevée, image zoomée,
        // jusqu'au tap suivant. Le survol ne sert que la souris ; le retour
        // tactile passe par `active:`.
        '[@media(hover:hover)]:hover:will-change-transform active:will-change-transform',
        'transition-[transform,box-shadow,border-color,background-color] duration-fast ease-motion-out',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
        // Critique 2026-08-24 (a11y) — `focus:` faisait COLLER l'anneau doré
        // après un tap tactile (même bug que le :hover traité juste au-dessus) ;
        // `focus-visible:` ne le rend qu'au clavier.
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2',
        // In-cart signal (#9): a gold ring so the cashier sees at a glance the
        // item is already on the ticket — cuts the rush double-add. `gold` is
        // a bare token (no alpha support outside the cat-* family) so the
        // ring is drawn at full strength rather than a dead `/50` alpha.
        inCart ? 'border-gold ring-1 ring-gold' : 'border-border-subtle',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:border-border-strong [@media(hover:hover)]:hover:bg-bg-overlay [@media(hover:hover)]:hover:shadow-lg active:scale-[0.97] active:translate-y-0 active:shadow-md',
      )}
    >
      <div className="relative aspect-[4/3] bg-bg-input overflow-hidden">
        {showImage ? (
          <img
            src={product.image_url ?? undefined}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
            className={cn(
              'object-cover w-full h-full transition-transform duration-slow ease-motion-out motion-reduce:transition-none',
              disabled ? 'grayscale' : '[@media(hover:hover)]:group-hover:scale-[1.06]',
            )}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <BrandMark size="lg" className="opacity-50" />
          </div>
        )}

        {/* Top-left cluster — in-cart count (most important), then promo/combo. */}
        {(inCart || promoActive || topLeftSlot) && (
          <div className="absolute top-2 left-2 flex flex-col items-start gap-1.5 z-10">
            {inCart && (
              <span
                className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-gold text-gold-fg text-xs font-bold font-mono tabular-nums"
                aria-label={`${cartQty} in cart`}
              >
                {cartQty}
              </span>
            )}
            {promoActive && <PromoBadge />}
            {topLeftSlot}
          </div>
        )}

        {/* Favorite star — shown ONLY when favourite (a meaningful pin), gold
            and legible. Favourites are set in the backoffice; this is a display
            indicator, not a toggle. */}
        {product.is_favorite && !overlayLabel && (
          <span
            aria-label="Favourite"
            // `bg-bg-base` is a bare token (no alpha outside cat-*); `--backdrop`
            // is the design system's own pre-baked translucent dark scrim,
            // exactly this "dim overlay on a photo" use case. Lot 5 : le
            // backdrop-blur-sm coûtait une couche de compositing par tuile
            // pour un flou invisible derrière une pastille de 28 px.
            className="absolute top-2 right-2 inline-flex items-center justify-center h-7 w-7 rounded-full bg-backdrop z-10"
          >
            <Star className="h-4 w-4 fill-gold text-gold" aria-hidden />
          </span>
        )}

        {/* Out-of-stock / disabled overlay — explicit and unmistakable. */}
        {overlayLabel && (
          <div className="absolute inset-0 grid place-items-center bg-backdrop z-20">
            <span
              id={`pc-overlay-${product.id}`}
              className="rotate-[-8deg] bg-bg-base px-3 py-1.5 rounded text-red-as-text text-sm font-extrabold uppercase tracking-widest border-2 border-red shadow-hairline"
            >
              {overlayLabel}
            </span>
          </div>
        )}

        {/* Low-stock ribbon at image bottom */}
        {!disabled && lowStockLabel && (
          <div className="absolute inset-x-0 bottom-0 bg-backdrop px-2 py-1 text-xs uppercase tracking-widest text-amber-warn font-semibold z-10 text-center">
            {lowStockLabel}
          </div>
        )}
      </div>

      <div className="px-2.5 py-2 space-y-0.5">
        <div
          id={`pc-name-${product.id}`}
          className="text-sm leading-tight font-medium text-text-primary line-clamp-2 min-h-[2.4em]"
          title={product.name}
        >
          {product.name}
        </div>
        {/* Price is the read-aloud, verified value (#8): at least as large as the
            name and bolder. Hidden on sold-out cards (they aren't priceable). */}
        {!disabled && (
          <span id={`pc-price-${product.id}`}>
            <Currency
              amount={product.retail_price}
              emphasis="gold"
              className="text-base font-mono font-bold tabular-nums"
            />
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * Wrapped in `React.memo` (P2 perf finding) — `ProductGrid` recomputes
 * `filtered`/`qtyByProduct` on every cart or search-query change, which
 * would otherwise re-render every tile in the grid on each keystroke/tap.
 * Default shallow prop comparison is sufficient as long as callers keep
 * `product`/`onSelect`/`topLeftSlot` referentially stable across renders
 * (ProductGrid memoizes the combo badge element for this reason).
 */
export const ProductCard = memo(ProductCardImpl);

function PromoBadge(): JSX.Element {
  return (
    <span
      data-testid="product-card-promo-badge"
      // `gold` has no alpha variant outside cat-* — `border-gold-soft` is the
      // project's established "muted border" pattern (see Login.tsx,
      // CurrentOrderCard.tsx) instead of a dead `border-gold/30`.
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold uppercase tracking-widest bg-gold-soft text-gold border border-gold-soft"
    >
      <span aria-hidden>%</span>
      Promo
    </span>
  );
}
