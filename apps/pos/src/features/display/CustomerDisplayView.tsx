// apps/pos/src/features/display/CustomerDisplayView.tsx
//
// Session 14 / Wave 3 / Phase 3.B — REWRITE.
// Split-brand redesign (owner request 2026-07-07) — RESTRUCTURED.
//
// Customer Display surface. Branded full-screen view of the **active order**
// being rung up at the POS. Designed for a SECONDARY MONITOR (1920x1080+),
// faces the customer.
//
// Layout is a permanent 50/50 split inside `BrandedLayout`:
//
//   ┌──────────────────────┬──────────────────────┐
//   │                      │  {order label}       │
//   │   BrandLogo (hero)   │  line rows            │
//   │   + slogan           │  (name, modifiers,   │
//   │   (CDBrandPanel)     │   qty × price, total)│
//   │                      │  totals band          │
//   └──────────────────────┴──────────────────────┘
//
// Line rows render the MODIFIER DETAIL (option label + price adjustment) under
// the product name, and the totals band carries a "Tax included" line (PB1 —
// tax is extracted from the total, prices are tax-inclusive).
//
// Token discipline:
//   - Zero hardcoded colors. All chrome from `@breakery/ui` semantic tokens
//     (text-gold, bg-bg-base, border-border-subtle, ...).
//   - Canonical fonts only — `font-display` (Playfair), `font-sans` (Inter),
//     `font-mono` (JetBrains Mono); no inline font-family.
//
// State source:
//   - This view is PRESENTATIONAL. The page wrapper (CustomerDisplayPage)
//     maps the cart broadcast to a flattened `items` + `totals` shape.
//     Display-side has no Supabase coupling — keeps the smoke tests fast and
//     isolation tight.
//
// Constraints (CLAUDE.md):
//   - File size <500 lines. TS strict. No `any`.
//   - Primitives from `@breakery/ui` only (BrandMark, EmptyState, Currency,
//     SectionLabel).

import type { JSX } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import {
  BrandMark,
  Currency,
  EmptyState,
  SectionLabel,
} from '@breakery/ui';

import { BrandedLayout } from './components/BrandedLayout';
import { CDBrandPanel } from './components/CDBrandPanel';

// ── Types ────────────────────────────────────────────────────────────

/** Modifier detail rendered under the product name. */
export interface CustomerDisplayModifier {
  label: string;
  /** IDR delta added to the unit price; 0 renders the label alone. */
  price_adjustment: number;
}

/**
 * Minimal line shape the display needs. Shaped from CartItem at the page
 * boundary so this view stays decoupled from the Cart domain type. The
 * page wrapper enriches `image_url` from the products lookup.
 */
export interface CustomerDisplayLine {
  id: string;
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  /** Pre-discount line total (qty * unit_price after modifier adjust). */
  line_total: number;
  /** Selected modifiers (option label + price delta). */
  modifiers?: CustomerDisplayModifier[];
  /** Optional product image. Falls back to BrandMark thumbnail when null. */
  image_url?: string | null;
  /** Promo gift line — renders a "PROMO" badge. */
  is_promo_gift?: boolean;
  /** Cancelled (post-send-to-kitchen). Strikethrough + "CANCELLED" badge. */
  is_cancelled?: boolean;
}

/** Totals slice passed verbatim from the cart broadcast. */
export interface CustomerDisplayTotals {
  subtotal: number;
  total: number;
  /** PB1 share of `total` — rendered as "Tax included" / "Tax" (mode-aware). */
  tax_amount?: number;
  item_count: number;
  /** Global tax mode (Lot 6b) — absent treated as inclusive (legacy senders). */
  tax_inclusive?: boolean;
}

export interface CustomerDisplayViewProps {
  /** Active-cart lines. Empty array → branded empty state. */
  items: CustomerDisplayLine[];
  /** Totals — only rendered when `items.length > 0`. */
  totals?: CustomerDisplayTotals;
  /** Order type / table label rendered in the header band. */
  orderLabel?: string | null;
  /** Footer microcopy override. Default: opening hours line. */
  footer?: string;
}

// ── Fit-to-panel scaling ─────────────────────────────────────────────
//
// The order mirror must show the WHOLE order at a glance — a scrollbar on a
// customer-facing screen is a bug, not a feature. Rows keep their generous,
// readable "counter distance" sizing; when the list would overflow the panel,
// the whole list is scaled DOWN uniformly (transform) so every line stays on
// screen. `scrollHeight`/`clientHeight` report the untransformed layout box, so
// the measurement never feeds back on the applied transform. Width is pre-
// inflated by 1/scale so the scaled-back list still fills the column.

interface FitScale {
  ref: (node: HTMLElement | null) => void;
  scale: number;
}

/**
 * Measures the list against its (fixed-height) container and returns a scale
 * factor in (0, 1]. Re-measures on container resize and whenever `deps` change
 * (i.e. the order lines). Fails safe to 1 in non-layout environments (jsdom).
 */
function useFitScale(deps: unknown): FitScale {
  const [scale, setScale] = useState(1);
  const nodeRef = useRef<HTMLElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const measure = useCallback(() => {
    const node = nodeRef.current;
    const parent = node?.parentElement;
    if (node === null || node === undefined || parent === null || parent === undefined) return;
    const available = parent.clientHeight;
    const natural = node.scrollHeight;
    if (available <= 0 || natural <= 0) {
      setScale(1);
      return;
    }
    // Round down slightly to avoid a 1px overflow re-triggering a scrollbar.
    const next = available >= natural ? 1 : Math.max(0.2, (available - 1) / natural);
    setScale((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
  }, []);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      nodeRef.current = node;
      if (node !== null && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => measure());
        if (node.parentElement !== null) ro.observe(node.parentElement);
        roRef.current = ro;
      }
    },
    [measure],
  );

  // Re-measure after every commit that changes the order lines.
  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, measure]);

  return { ref, scale };
}

// ── Subcomponents ────────────────────────────────────────────────────

interface LineRowProps {
  line: CustomerDisplayLine;
}

/**
 * Single cart-line row. Photo (or BrandMark fallback) + name + modifiers +
 * meta + total. Sized for a SECONDARY MONITOR — base font is up-scaled so a
 * customer standing at the counter can read it from ~1.5m.
 */
function LineRow({ line }: LineRowProps): JSX.Element {
  const isCancelled = line.is_cancelled === true;
  const modifiers = line.modifiers ?? [];
  return (
    <li
      className="flex items-center gap-5 rounded-3xl border border-border-subtle bg-bg-elevated px-6 py-5"
      data-testid="display-line-row"
      data-line-id={line.id}
    >
      {/* Photo / fallback ─ 80px square */}
      <div
        className="flex-none w-20 h-20 rounded-2xl overflow-hidden border border-border-subtle bg-bg-base flex items-center justify-center"
        aria-hidden="true"
      >
        {line.image_url ? (
          <img
            src={line.image_url}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <BrandMark size="md" />
        )}
      </div>

      {/* Name + modifiers + meta ─ flex grow */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h3
            className={
              'font-display text-2xl text-text-primary truncate' +
              (isCancelled ? ' line-through text-text-muted' : '')
            }
            data-testid="display-line-name"
          >
            {line.name}
          </h3>
          {line.is_promo_gift === true && (
            <SectionLabel
              as="span"
              className="text-gold tracking-widest"
              data-testid="display-line-promo-badge"
            >
              Promo
            </SectionLabel>
          )}
          {isCancelled && (
            <SectionLabel
              as="span"
              className="text-danger tracking-widest"
              data-testid="display-line-cancelled-badge"
            >
              Cancelled
            </SectionLabel>
          )}
        </div>
        {modifiers.length > 0 && (
          <ul className="flex flex-col gap-0.5" data-testid="display-line-modifiers">
            {modifiers.map((mod, idx) => (
              <li
                key={`${line.id}-mod-${idx}`}
                className={
                  'text-sm text-text-secondary' +
                  (isCancelled ? ' line-through text-text-muted' : '')
                }
                data-testid="display-line-modifier"
              >
                <span className="text-text-muted mr-1">+</span>
                {mod.label}
                {mod.price_adjustment !== 0 && (
                  <span className="ml-2 font-mono">
                    {mod.price_adjustment > 0 ? '+' : '−'}
                    <Currency
                      amount={Math.abs(mod.price_adjustment)}
                      className="text-text-secondary"
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-text-secondary font-mono">
          <span data-testid="display-line-qty">{line.quantity}</span>
          <span className="mx-2 text-text-muted">×</span>
          <Currency amount={line.unit_price} className="text-text-secondary" />
        </p>
      </div>

      {/* Line total ─ right column */}
      <div className="flex-none" data-testid="display-line-total">
        <Currency
          amount={line.line_total}
          className={
            'text-2xl text-text-primary' +
            (isCancelled ? ' line-through text-text-muted' : '')
          }
        />
      </div>
    </li>
  );
}

interface TotalsBandProps {
  totals: CustomerDisplayTotals;
}

/**
 * Bottom totals band. Subtotal + item count + "Tax included" on the left,
 * GRAND TOTAL in gold mono on the right. Up-scaled for the secondary monitor.
 */
function TotalsBand({ totals }: TotalsBandProps): JSX.Element {
  return (
    <div
      className="mt-6 rounded-3xl border border-gold-soft bg-bg-elevated px-8 py-6 flex items-center justify-between gap-6"
      data-testid="display-totals-band"
    >
      <div className="flex flex-col gap-1">
        <SectionLabel size="sm">Subtotal</SectionLabel>
        <span data-testid="display-subtotal">
          <Currency
            amount={totals.subtotal}
            className="text-2xl text-text-secondary"
          />
        </span>
        <p className="mt-1 text-xs uppercase tracking-widest text-text-muted">
          {totals.item_count} item{totals.item_count === 1 ? '' : 's'}
        </p>
        {totals.tax_amount !== undefined && totals.tax_amount > 0 && (
          <p
            className="text-xs uppercase tracking-widest text-text-muted"
            data-testid="display-tax-included"
          >
            {(totals.tax_inclusive ?? true) ? 'Tax included' : 'Tax'} ·{' '}
            <Currency amount={totals.tax_amount} className="text-text-muted" />
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <SectionLabel size="sm" className="text-gold">
          Total
        </SectionLabel>
        <span data-testid="display-grand-total">
          <Currency amount={totals.total} emphasis="gold" className="text-5xl" />
        </span>
      </div>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────

/**
 * Branded customer-display view. Permanent split: brand panel (left half) +
 * active order list / empty state (right half), inside `BrandedLayout` chrome.
 */
export function CustomerDisplayView({
  items,
  totals,
  orderLabel,
  footer,
}: CustomerDisplayViewProps): JSX.Element {
  const hasItems = items.length > 0;
  // Scale the whole list down to fit the panel when it would overflow — the
  // customer sees the ENTIRE order, never a scrollbar. Re-measures on line count.
  const fit = useFitScale(items.length);

  return (
    <BrandedLayout
      footer={
        footer !== undefined ? (
          <span>{footer}</span>
        ) : hasItems ? (
          <span data-testid="display-footer-active">
            Showing items as your cashier rings them up.
          </span>
        ) : (
          <span>Open daily · 07:00 — 21:00</span>
        )
      }
    >
      <div className="h-full flex gap-10">
        {/* Brand moment — logo + slogan (left half, always). */}
        <div className="flex-1 min-h-0 flex">
          <CDBrandPanel />
        </div>

        {/* Order mirror (right half). */}
        {!hasItems ? (
          <div
            className="flex-1 min-h-0 grid place-items-center"
            data-testid="display-view-empty"
          >
            <EmptyState
              tone="branded"
              size="lg"
              title="Welcome to The Breakery"
              description="Your order will appear here as the cashier rings it up."
            />
          </div>
        ) : (
          <div
            className="flex-1 min-h-0 flex flex-col"
            data-testid="display-view-active"
          >
            {orderLabel !== null && orderLabel !== undefined && orderLabel !== '' && (
              <div className="mb-4 flex items-baseline justify-between gap-6">
                <SectionLabel size="sm" data-testid="display-order-label">
                  {orderLabel}
                </SectionLabel>
                <SectionLabel size="sm" className="text-text-muted">
                  Live order
                </SectionLabel>
              </div>
            )}
            {/* Fixed-height viewport; the list inside scales to fit it. */}
            <div className="flex-1 min-h-0 overflow-hidden" data-testid="display-line-viewport">
              <ul
                ref={fit.ref}
                className="flex flex-col gap-3 pr-2 origin-top-left"
                style={{
                  transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined,
                  width: fit.scale < 1 ? `${100 / fit.scale}%` : undefined,
                }}
                data-testid="display-line-list"
                data-fit-scale={fit.scale}
                aria-label="Order items"
              >
                {items.map((line) => (
                  <LineRow key={line.id} line={line} />
                ))}
              </ul>
            </div>
            {totals !== undefined && <TotalsBand totals={totals} />}
          </div>
        )}
      </div>
    </BrandedLayout>
  );
}
