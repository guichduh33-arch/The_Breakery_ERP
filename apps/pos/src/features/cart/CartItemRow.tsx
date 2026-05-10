// apps/pos/src/features/cart/CartItemRow.tsx
import { Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CartItem } from '@breakery/domain';
import { Button, Currency, QuantityStepper, cn, ComboLineRow } from '@breakery/ui';
import { LineDiscountButton } from '@/features/discounts/components/LineDiscountButton';
import { useComboItems } from '@/features/combos/hooks/useComboItems';

export interface CartItemRowProps {
  item: CartItem;
  locked: boolean;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
  onApplyLineDiscount?: (item: CartItem) => void;
}

function ComboCartItemRow({ item, locked, onChangeQty, onRemove }: Omit<CartItemRowProps, 'onApplyLineDiscount'>) {
  const { data: comboItems = [] } = useComboItems(item.product_id);
  const components = comboItems.map((ci) => ({ name: ci.product.name, quantity: ci.quantity }));
  const lineTotal = item.unit_price * item.quantity;

  return (
    <ComboLineRow
      comboItem={{ id: item.id, product_id: item.product_id, name: item.name, quantity: item.quantity, unit_price: item.unit_price, line_total: lineTotal }}
      components={components}
      isLocked={locked}
      onRemove={() => onRemove()}
      onQuantityChange={(_id, qty) => onChangeQty(qty)}
    />
  );
}

export function CartItemRow({ item, locked, onChangeQty, onRemove, onApplyLineDiscount }: CartItemRowProps) {
  if (item.product_type === 'combo') {
    return <ComboCartItemRow item={item} locked={locked} onChangeQty={onChangeQty} onRemove={onRemove} />;
  }

  const adj = item.modifiers.reduce((s, m) => s + m.price_adjustment, 0);
  const lineTotal = (item.unit_price + adj) * item.quantity;

  function handleRemove() {
    if (locked) {
      toast.error('Item already sent. Cannot cancel.');
      return;
    }
    onRemove();
  }

  return (
    <div
      className={cn(
        'flex items-start justify-between px-4 py-2 border-b border-border-subtle gap-2',
        locked && 'bg-bg-overlay/40',
      )}
      data-promo-gift={item.is_promo_gift ? 'true' : undefined}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {locked && (
            <Lock
              className="h-3 w-3 text-text-muted shrink-0"
              aria-label="Sent to kitchen — locked"
            />
          )}
          <div className="text-sm truncate">{item.name}</div>
          {item.is_promo_gift && (
            <span
              className="inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-300"
              aria-label="Free gift from promotion"
            >
              Promo
            </span>
          )}
        </div>
        {item.modifiers.length > 0 && (
          <div className="text-xs text-text-secondary mt-0.5 truncate">
            {item.modifiers.map((m) => m.option_label).join(' · ')}
          </div>
        )}
      </div>
      <div className={cn(locked && 'opacity-50 pointer-events-none')}>
        <QuantityStepper value={item.quantity} onChange={onChangeQty} min={0} />
      </div>
      <div className="w-24 text-right shrink-0">
        <Currency amount={lineTotal} emphasis="gold" className="text-sm" />
        {item.discount && (
          <div className="text-xs text-red-400 font-mono">
            -{item.discount.type === 'percentage' ? `${item.discount.value}%` : <Currency amount={item.discount.amount} />}
          </div>
        )}
      </div>
      {onApplyLineDiscount && !locked && (
        <LineDiscountButton
          onClick={() => onApplyLineDiscount(item)}
          hasDiscount={Boolean(item.discount)}
        />
      )}
      <Button
        variant="ghostDestructive"
        size="icon"
        onClick={handleRemove}
        aria-label={locked ? 'Item locked — sent to kitchen' : 'Remove item'}
        title={locked ? 'Sent to kitchen' : undefined}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
