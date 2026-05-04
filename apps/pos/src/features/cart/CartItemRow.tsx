// apps/pos/src/features/cart/CartItemRow.tsx
import { Trash2 } from 'lucide-react';
import type { CartItem } from '@breakery/domain';
import { Currency, QuantityStepper, Button } from '@breakery/ui';

export interface CartItemRowProps {
  item: CartItem;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
}

export function CartItemRow({ item, onChangeQty, onRemove }: CartItemRowProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{item.name}</div>
      </div>
      <QuantityStepper value={item.quantity} onChange={onChangeQty} min={0} />
      <div className="w-24 text-right">
        <Currency amount={item.unit_price * item.quantity} emphasis="gold" className="text-sm" />
      </div>
      <Button variant="ghostDestructive" size="icon" onClick={onRemove} aria-label="Remove item">
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
