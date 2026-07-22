// apps/pos/src/features/cart/VariantSelectModal.tsx
// Session 27c — POS modal to pick a variant when tapping a parent product.
//
// When a cashier taps a parent product on the POS grid (a product that has
// children rows in the `products` table via `parent_product_id`), this modal
// renders a tile grid of the active variants. Tapping a tile invokes
// `onPick(variant)` and closes the modal — the parent component is then
// expected to forward the chosen variant to `cartStore.add`.
//
// UX shortcut: if the parent has exactly one active variant, the modal
// auto-picks it on mount (no useless extra tap).
//
// Disabled state: a tile is disabled when the variant is inactive OR (it
// tracks stock AND current_stock ≤ 0). Mirrors the soft-out behaviour of
// `ProductCard` for the main grid.
//
// ADR-011 §3 — the auto-pick shortcut is gated on the SAME sellability check
// as the tiles: a lone sold-out variant used to be auto-added to the cart,
// silently bypassing the disabled state. It now keeps the modal open so the
// cashier sees the greyed-out tile (stock 0) instead.

import { useEffect, type JSX } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import {
  useProductVariants,
  type POSVariantRow,
} from '@/features/products/hooks/useProductVariants';

export interface VariantSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent: { id: string; name: string } | null;
  onPick: (variant: POSVariantRow) => void;
}

function isVariantDisabled(v: POSVariantRow): boolean {
  return !v.is_active || (v.deduct_stock && (v.current_stock ?? 0) <= 0);
}

export function VariantSelectModal({
  open,
  onOpenChange,
  parent,
  onPick,
}: VariantSelectModalProps): JSX.Element | null {
  const { data: variants = [] } = useProductVariants(parent?.id);

  // UX shortcut : if parent has exactly 1 active SELLABLE variant, auto-pick.
  useEffect(() => {
    if (open && variants.length === 1 && !isVariantDisabled(variants[0]!)) {
      onPick(variants[0]!);
      onOpenChange(false);
    }
  }, [open, variants, onPick, onOpenChange]);

  if (!parent) return null;

  const axis = variants[0]?.variant_axis;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parent.name}</DialogTitle>
          {axis && (
            <Badge variant="outline" className="w-fit capitalize">
              {axis}
            </Badge>
          )}
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          {variants.map((v) => {
            const disabled = isVariantDisabled(v);
            return (
              <button
                key={v.id}
                type="button"
                disabled={disabled}
                data-testid={`variant-tile-${v.id}`}
                onClick={() => {
                  onPick(v);
                  onOpenChange(false);
                }}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  disabled
                    ? 'cursor-not-allowed border-border-subtle bg-bg-muted opacity-50'
                    : 'border-gold/40 bg-gold/5 hover:bg-gold/10'
                }`}
              >
                <div className="text-base font-semibold">{v.variant_label}</div>
                <div className="text-sm font-mono">
                  {formatIdr(v.retail_price)}
                </div>
                {v.deduct_stock && (
                  <div className="text-xs text-text-muted">
                    stock {v.current_stock ?? 0}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
