// apps/pos/src/features/cart/CartLineRow.tsx
//
// POS Active-Order line row — dense "collapsed" layout (cart redesign v2):
//
//   [ qty× ]  Name (wraps ≤2 lines)                    price
//             🏷 modifiers · @unit                       −disc
//                                                      [ 🗑 / 🔒 ]
//
// Design decisions (owner-approved 2026-07-10, skill pos-design-craft):
//   #1 name uses line-clamp-2 (full variant name visible) — NOT hard truncate.
//   #2 the permanent 152px stepper is gone; quantity is a compact chip that
//      opens the Numpad (onEditQty, lifted to ActiveOrderPanel). +1 happens by
//      re-ringing the product from the grid.
//   #3 no stepper "+" → the discount tag can't collide with it anymore.
//   #4 a single lock affordance: the gold left rail + the trailing lock button.
//      The old duplicate title-lock icon is removed.
//   #5 remove sits on the RIGHT (out of the add-reflex zone). Immediate removal
//      with a 5s undo toast is wired by the parent (onRemove); no blocking
//      confirm on the frequent gesture.
//   #6 collapsing the stepper row takes each line from ~100px to ~64px → 6-7
//      lines visible instead of 4.
//   #7 modifiers + per-unit price are shown inline (unit price when qty>1, the
//      case where the line total alone can't be verified). Kitchen notes are
//      out of scope: CartItem carries no note field (separate work item).
//
// Test contract preserved:
//   - Unlocked remove button: aria-label "Remove {name}".
//   - Locked: a button whose aria-label matches /sent to kitchen/i is present
//     ("Request cancel (sent to kitchen)" / "Item locked — sent to kitchen").
//   - Discount button: aria-label "Apply discount on {name}" / "Edit discount
//     on {name}", absent on locked/cancelled/gift lines.
//   - Combo lines defer to <ComboLineRow> (unchanged).

import { Lock, Tag, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import { toast } from 'sonner';
import { calculatePriceAdjustment } from '@breakery/domain';
import type { CartItem } from '@breakery/domain';
import { Currency, ComboLineRow, cn } from '@breakery/ui';
import { useComboConfig } from '@/features/combos/hooks/useComboConfig';

export interface CartLineRowProps {
  item: CartItem;
  locked: boolean;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
  /** Open the quantity Numpad for this line (lifted to ActiveOrderPanel). */
  onEditQty?: (item: CartItem) => void;
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
}: Omit<CartLineRowProps, 'onRequestCancel' | 'onApplyLineDiscount' | 'onEditQty'>): JSX.Element {
  const { data: def } = useComboConfig(item.product_id);
  // The line's OWN composition is what the order will record — it is the only
  // truthful source. The definition resolves component labels; its defaults
  // are never displayed (a default is not a choice — bug 2026-07-31).
  const labelByProductId = new Map(
    (def?.groups ?? []).flatMap((g) =>
      g.options.map((o) => [o.component_product_id, o.label] as const),
    ),
  );
  const components: { name: string; quantity: number }[] = [];
  for (const comp of item.combo_components ?? []) {
    const label = labelByProductId.get(comp.product_id) ?? 'Component';
    const answers = (comp.modifiers ?? []).map((m) => m.option_label).join(' · ');
    const name = answers ? `${label} — ${answers}` : label;
    const existing = components.find((c) => c.name === name);
    if (existing) {
      existing.quantity += comp.quantity;
    } else {
      components.push({ name, quantity: comp.quantity });
    }
  }
  // Same formula as calculateTotals and as the server price resolver:
  // base (unit_price) + option surcharges (line modifiers) + component-modifier
  // adjustments (ADR-017). A line billed at base × qty understated what the
  // cart charges (bug 2026-07-31).
  const unitEach =
    item.unit_price +
    calculatePriceAdjustment(item.modifiers) +
    (item.combo_components ?? []).reduce(
      (sum, c) => sum + calculatePriceAdjustment(c.modifiers ?? []),
      0,
    );
  const lineTotal = unitEach * item.quantity;

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
  onEditQty,
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
  const unitEach = item.unit_price + adj;
  const lineTotal = unitEach * item.quantity;
  const cancelled = item.is_cancelled === true;
  const hasMods = item.modifiers.length > 0;
  const isGift = item.is_promo_gift === true;
  const editable = !locked && !cancelled && !isGift;
  const showUnit = item.quantity > 1 && !isGift;

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

  // Whether the metadata row (mods / unit price / status) renders at all.
  const showMeta = hasMods || showUnit || locked || isGift;

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 py-2 pl-2.5 pr-1.5 rounded-md bg-bg-overlay border border-border-subtle',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-300 motion-safe:ease-out',
        locked && 'relative pl-3.5 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-gold before:rounded-r',
        cancelled && 'opacity-60',
      )}
      data-promo-gift={isGift ? 'true' : undefined}
      data-cancelled={cancelled ? 'true' : undefined}
    >
      {/* Quantity chip — 44px tap target; opens the Numpad. Static for
          locked / cancelled / gift lines (not user-editable). */}
      {editable && onEditQty ? (
        <button
          type="button"
          onClick={() => onEditQty(item)}
          aria-label={`Edit quantity for ${item.name}`}
          className={cn(
            'h-11 min-w-[2.75rem] shrink-0 px-1.5 grid place-items-center rounded-md',
            'bg-bg-input border border-border-strong text-text-primary transition-colors',
            'hover:bg-bg-overlay focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
          )}
        >
          <span className="font-mono tabular-nums text-base font-bold leading-none">
            {item.quantity}
            <span className="text-text-muted font-medium text-sm">×</span>
          </span>
        </button>
      ) : (
        <div
          className="h-11 min-w-[2.75rem] shrink-0 px-1.5 grid place-items-center"
          aria-hidden
        >
          <span className="font-mono tabular-nums text-base font-bold leading-none text-text-secondary">
            {item.quantity}
            <span className="text-text-muted font-medium text-sm">×</span>
          </span>
        </div>
      )}

      {/* Center — name (wraps ≤2 lines) + optional metadata row. */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5">
          <span
            className={cn(
              'text-sm font-semibold leading-tight line-clamp-2',
              cancelled && 'line-through text-text-muted',
            )}
          >
            {item.name}
          </span>
          {isGift && (
            <span
              className="mt-0.5 shrink-0 inline-flex items-center rounded-full border border-gold bg-gold-soft px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-gold"
              aria-label="Free gift from promotion"
            >
              Promo
            </span>
          )}
          {cancelled && (
            <span
              className="mt-0.5 shrink-0 inline-flex items-center rounded-full border border-red bg-red-soft px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-as-text"
              aria-label="Cancelled"
            >
              Cancelled
            </span>
          )}
        </div>

        {showMeta && (
          <div className="mt-1 flex items-center gap-1.5 text-xs min-w-0">
            {hasMods && (
              <span
                className={cn(
                  'italic truncate',
                  cancelled ? 'line-through text-text-muted' : 'text-gold',
                )}
              >
                {item.modifiers.map((m) => m.option_label).join(' · ')}
              </span>
            )}
            {showUnit && (
              <span className="shrink-0 font-mono tabular-nums text-text-secondary">
                {hasMods && <span className="text-text-muted">· </span>}@ <Currency amount={unitEach} />
              </span>
            )}
            {locked && !cancelled && (
              <span className="shrink-0 text-text-secondary">Sent to kitchen</span>
            )}
            {isGift && <span className="shrink-0 italic text-text-secondary">Free gift</span>}
          </div>
        )}
      </div>

      {/* Per-line discount control (manager-PIN gated downstream). */}
      {onApplyLineDiscount && editable && (
        <button
          type="button"
          onClick={() => onApplyLineDiscount(item)}
          aria-label={item.discount ? `Edit discount on ${item.name}` : `Apply discount on ${item.name}`}
          className={cn(
            'h-11 w-11 shrink-0 grid place-items-center rounded-md transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
            item.discount ? 'text-gold border border-gold' : 'text-text-muted border border-border-subtle hover:text-text-primary hover:bg-bg-input',
          )}
        >
          <Tag className="h-4 w-4" aria-hidden />
        </button>
      )}

      {/* Price — line total + discount indicator. */}
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
          <div className="text-xs text-red-as-text font-mono tabular-nums">
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

      {/* Remove / lock control — RIGHT (out of the add-reflex zone). */}
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
          'h-11 w-11 shrink-0 grid place-items-center rounded-md transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
          locked
            ? 'text-gold'
            : 'text-text-muted hover:text-red-as-text hover:bg-red-soft',
          cancelled && 'opacity-50 pointer-events-none',
        )}
      >
        {locked && !cancelled ? (
          <Lock className="h-4 w-4" aria-hidden />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
