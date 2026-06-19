// apps/pos/src/features/cart/CartLineRow.tsx
//
// POS Active-Order line row — "delete-first" layout:
//   [ 🗑 ]  Name / stepper-or-promo            price
//
// The remove control sits FIRST (left) per the cart redesign. Locked rows keep
// their existing semantics (lock affordance + request-cancel for tablet
// pickups); cancelled rows render struck-through and disabled. Combo lines
// defer to <ComboLineRow> (unchanged).
//
// Test contract preserved:
//   - Unlocked remove button: aria-label "Remove {name}".
//   - Locked: a "Sent to kitchen — locked" label is present (lock icon) and the
//     left control is "Request cancel (sent to kitchen)" / "Item locked — sent
//     to kitchen".

import { Lock, Tag, Trash2, XCircle } from 'lucide-react';
import type { JSX } from 'react';
import { toast } from 'sonner';
import type { CartItem } from '@breakery/domain';
import { Currency, QuantityStepper, cn, ComboLineRow } from '@breakery/ui';
import { useComboConfig } from '@/features/combos/hooks/useComboConfig';

export interface CartLineRowProps {
  item: CartItem;
  locked: boolean;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
  /** Open the per-line discount flow for this item (manager-PIN gated downstream). */
  onApplyLineDiscount?: (item: CartItem) => void;
  /**
   * Provided by ActiveOrderPanel when the cart is rooted on a tablet pickup
   * (item.id is a real UUID, so the cancel-item RPC can address it).
   */
  onRequestCancel?: (item: CartItem) => void;
}

function ComboCartLineRow({
  item,
  locked,
  onChangeQty,
  onRemove,
}: Omit<CartLineRowProps, 'onRequestCancel' | 'onApplyLineDiscount'>): JSX.Element {
  const { data: def } = useComboConfig(item.product_id);
  // Flatten all default options across groups for the component summary display.
  const components = (def?.groups ?? []).flatMap((g) =>
    g.options
      .filter((o) => o.is_default)
      .map((o) => ({ name: o.label, quantity: 1 })),
  );
  const lineTotal = item.unit_price * item.quantity;

  return (
    <ComboLineRow
      comboItem={{
        id: item.id,
        product_id: item.product_id,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: lineTotal,
      }}
      components={components}
      isLocked={locked}
      onRemove={() => onRemove()}
      onQuantityChange={(_id, qty) => onChangeQty(qty)}
    />
  );
}

export function CartLineRow({
  item,
  locked,
  onChangeQty,
  onRemove,
  onApplyLineDiscount,
  onRequestCancel,
}: CartLineRowProps): JSX.Element {
  if (item.product_type === 'combo') {
    return (
      <ComboCartLineRow
        item={item}
        locked={locked}
        onChangeQty={onChangeQty}
        onRemove={onRemove}
      />
    );
  }

  const adj = item.modifiers.reduce((s, m) => s + m.price_adjustment, 0);
  const lineTotal = (item.unit_price + adj) * item.quantity;
  const cancelled = item.is_cancelled === true;
  const hasMods = item.modifiers.length > 0;
  const isGift = item.is_promo_gift === true;

  function handleRemove(): void {
    if (cancelled) {
      toast.info('Item already cancelled');
      return;
    }
    if (locked) {
      if (onRequestCancel) {
        onRequestCancel(item);
        return;
      }
      toast.error('Item already sent. Cannot cancel.');
      return;
    }
    onRemove();
  }

  const removeAriaLabel = cancelled
    ? 'Item cancelled'
    : locked
      ? onRequestCancel
        ? 'Request cancel (sent to kitchen)'
        : 'Item locked — sent to kitchen'
      : `Remove ${item.name}`;

  return (
    <div
      className={cn(
        'flex items-center gap-2 p-3 rounded-md bg-bg-overlay border border-border-subtle',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-300 motion-safe:ease-out',
        locked && 'before:absolute relative before:inset-y-2 before:left-0 before:w-0.5 before:bg-gold/60 before:rounded-r',
        cancelled && 'opacity-60',
      )}
      data-promo-gift={isGift ? 'true' : undefined}
      data-cancelled={cancelled ? 'true' : undefined}
    >
      {/* Remove / lock control — FIRST (left). */}
      <button
        type="button"
        onClick={handleRemove}
        disabled={cancelled}
        aria-label={removeAriaLabel}
        title={
          cancelled
            ? 'Cancelled'
            : locked
              ? onRequestCancel
                ? 'Request cancel (manager PIN)'
                : 'Sent to kitchen'
              : undefined
        }
        className={cn(
          'h-8 w-8 shrink-0 grid place-items-center rounded-md transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
          locked
            ? 'text-gold/70'
            : 'text-text-muted hover:text-red-fg hover:bg-red-soft',
          cancelled && 'opacity-50 pointer-events-none',
        )}
      >
        {locked && !cancelled ? (
          <Lock className="h-4 w-4" aria-hidden />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
      </button>

      {/* Center block — name + stepper OR promo mention. */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {locked && !cancelled && (
            <Lock className="h-3 w-3 text-gold shrink-0" aria-label="Sent to kitchen — locked" />
          )}
          {cancelled && (
            <XCircle className="h-3 w-3 text-red shrink-0" aria-label="Cancelled" />
          )}
          <span
            className={cn(
              'text-sm font-semibold truncate',
              cancelled && 'line-through text-text-muted',
            )}
          >
            {item.name}
          </span>
          {isGift && (
            <span
              className="inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-300"
              aria-label="Free gift from promotion"
            >
              Promo
            </span>
          )}
          {cancelled && (
            <span
              className="inline-flex items-center rounded-full border border-red/40 bg-red-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red"
              aria-label="Cancelled"
            >
              Cancelled
            </span>
          )}
        </div>

        {hasMods && (
          <div
            className={cn(
              'text-xs italic mt-0.5 truncate',
              cancelled ? 'line-through text-text-muted' : 'text-gold/80',
            )}
          >
            {item.modifiers.map((m) => m.option_label).join(' · ')}
          </div>
        )}

        {/* Stepper for editable items ; promo mention for free gifts. */}
        <div className="mt-1.5">
          {isGift ? (
            <span className="text-[11px] italic text-text-secondary">Free gift</span>
          ) : (
            <div className={cn((locked || cancelled) && 'opacity-50 pointer-events-none')}>
              <QuantityStepper value={item.quantity} onChange={onChangeQty} min={0} />
            </div>
          )}
        </div>
      </div>

      {/* Per-line discount control (manager-PIN gated downstream). */}
      {onApplyLineDiscount && !locked && !cancelled && !isGift && (
        <button
          type="button"
          onClick={() => onApplyLineDiscount(item)}
          aria-label={item.discount ? `Edit discount on ${item.name}` : `Apply discount on ${item.name}`}
          className={cn(
            'h-8 w-8 shrink-0 grid place-items-center rounded-md transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
            item.discount ? 'text-gold' : 'text-text-muted hover:text-text-primary hover:bg-bg-input',
          )}
        >
          <Tag className="h-4 w-4" aria-hidden />
        </button>
      )}

      {/* Price — right (+ discount indicator). */}
      <div className="shrink-0 text-right">
        <Currency
          amount={lineTotal}
          {...(cancelled ? {} : { emphasis: 'gold' as const })}
          className={cn(
            'font-mono tabular-nums text-sm font-semibold',
            cancelled && 'line-through text-text-muted',
          )}
        />
        {item.discount && !cancelled && (
          <div className="text-[11px] text-red-fg font-mono">
            {item.discount.type === 'percentage' ? (
              `-${item.discount.value}%`
            ) : (
              <span>
                -<Currency amount={item.discount.amount} />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
