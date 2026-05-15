// apps/pos/src/features/cart/CartLineRow.tsx
//
// Session 14 / Phase 2.B — visual rewrite of the cart line row to match the
// Active Order references.
//
// Refs:
//   - docs/Design/caissapp/30-cart-active-2items-dine-in-totals.jpg
//   - docs/Design/caissapp/32-cart-locked-items-after-kitchen-send.jpg
//
// Visual anatomy (per ref 30):
//   ┌──────────────────────────────────────────────────────────────┐
//   │ [lock?] 1x  Americano                          ⊘              │  ← title row
//   │             HOT/ICE: HOT                                       │  ← modifiers (gold italic)
//   │  ┌───┐ ┌───┐ ┌───┐                  [tag] Rp 35,000  [lock?]  │  ← controls row
//   │  │ − │ │ 1 │ │ + │                                             │
//   │  └───┘ └───┘ └───┘                                             │
//   └──────────────────────────────────────────────────────────────┘
//
// Locked variant (ref 32):
//   - Faded background (bg-bg-overlay/40)
//   - Lock icon left of "1x" + lock icon right of price
//   - QuantityStepper visually disabled (opacity)
//   - Trash button → "Request cancel" via onRequestCancel (manager PIN)
//
// Combo lines defer to <ComboLineRow> (unchanged from prior implementation).
//
// Test contract preserved:
//   - aria-label "Item locked — sent to kitchen" or "Request cancel (sent to
//     kitchen)" on the trash button when locked.
//   - aria-label "Remove item" when unlocked.
//   - First text node of locked icon also "Sent to kitchen — locked".

import { Lock, Trash2, XCircle } from 'lucide-react';
import type { JSX } from 'react';
import { toast } from 'sonner';
import type { CartItem } from '@breakery/domain';
import { Button, Currency, QuantityStepper, cn, ComboLineRow } from '@breakery/ui';
import { LineDiscountButton } from '@/features/discounts/components/LineDiscountButton';
import { useComboItems } from '@/features/combos/hooks/useComboItems';

export interface CartLineRowProps {
  item: CartItem;
  locked: boolean;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
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
}: Omit<CartLineRowProps, 'onApplyLineDiscount'>): JSX.Element {
  const { data: comboItems = [] } = useComboItems(item.product_id);
  const components = comboItems.map((ci) => ({ name: ci.product.name, quantity: ci.quantity }));
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

  return (
    <div
      className={cn(
        'relative px-4 py-3 border-b border-border-subtle',
        // Locked rows: faded background and a subtle gold left accent so the
        // cashier can spot at-a-glance which lines are still editable.
        locked && 'bg-bg-overlay/40 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-gold/60 before:rounded-r',
        cancelled && 'opacity-60',
      )}
      data-promo-gift={item.is_promo_gift ? 'true' : undefined}
      data-cancelled={cancelled ? 'true' : undefined}
    >
      {/* Title row — qty prefix + name + status icons */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {locked && !cancelled && (
              <Lock
                className="h-3 w-3 text-gold shrink-0"
                aria-label="Sent to kitchen — locked"
              />
            )}
            {cancelled && (
              <XCircle className="h-3 w-3 text-red shrink-0" aria-label="Cancelled" />
            )}
            <span className="font-mono text-xs text-text-muted shrink-0">
              {item.quantity}x
            </span>
            <span
              className={cn(
                'text-sm font-medium truncate',
                cancelled && 'line-through text-text-muted',
              )}
            >
              {item.name}
            </span>
            {item.is_promo_gift && (
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
                'text-xs italic mt-0.5 truncate pl-5',
                cancelled ? 'line-through text-text-muted' : 'text-gold/80',
              )}
            >
              {item.modifiers.map((m) => m.option_label).join(' · ')}
            </div>
          )}
        </div>
      </div>

      {/* Controls row — stepper left, price + actions right */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className={cn((locked || cancelled) && 'opacity-50 pointer-events-none')}>
          <QuantityStepper value={item.quantity} onChange={onChangeQty} min={0} />
        </div>
        <div className="flex items-center gap-1">
          {onApplyLineDiscount && !locked && !cancelled && (
            <LineDiscountButton
              onClick={() => onApplyLineDiscount(item)}
              hasDiscount={Boolean(item.discount)}
            />
          )}
          <div className="text-right">
            <Currency
              amount={lineTotal}
              {...(cancelled ? {} : { emphasis: 'gold' as const })}
              className={cn(
                'text-sm font-semibold',
                cancelled && 'line-through text-text-muted',
              )}
            />
            {item.discount && !cancelled && (
              <div className="text-xs text-red font-mono">
                -
                {item.discount.type === 'percentage' ? (
                  `${item.discount.value}%`
                ) : (
                  <Currency amount={item.discount.amount} />
                )}
              </div>
            )}
          </div>
          <Button
            variant="ghostDestructive"
            size="icon"
            onClick={handleRemove}
            disabled={cancelled}
            aria-label={
              cancelled
                ? 'Item cancelled'
                : locked
                  ? onRequestCancel
                    ? 'Request cancel (sent to kitchen)'
                    : 'Item locked — sent to kitchen'
                  : 'Remove item'
            }
            title={
              cancelled
                ? 'Cancelled'
                : locked
                  ? onRequestCancel
                    ? 'Request cancel (manager PIN)'
                    : 'Sent to kitchen'
                  : undefined
            }
          >
            {locked && !cancelled ? (
              <Lock className="h-4 w-4 text-text-muted" aria-hidden />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
