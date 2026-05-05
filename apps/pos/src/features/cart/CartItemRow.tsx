// apps/pos/src/features/cart/CartItemRow.tsx
import { Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CartItem } from '@breakery/domain';
import { Button, Currency, QuantityStepper, cn } from '@breakery/ui';

export interface CartItemRowProps {
  item: CartItem;
  locked: boolean;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
}

export function CartItemRow({ item, locked, onChangeQty, onRemove }: CartItemRowProps) {
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
      </div>
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
